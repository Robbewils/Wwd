const welcomeTitle = document.getElementById('welcome_title');
const serviceTypeLabels = {
  new_site_basic: 'Nieuwe website (basis)',
  new_site_premium: 'Nieuwe website (premium)',
  new_site_max: 'Nieuwe website (max)',
  maintenance: 'Onderhoud',
  other: 'Anders',
};
const paymentCurrencyFormat = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });

async function showWelcomeUsername() {
  if (!welcomeTitle) return;

  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    if (!response.ok) return;

    const session = await response.json();
    if (session.username) {
      welcomeTitle.textContent = `Welkom, ${session.username}`;
    }
  } catch (error) {
    console.error('De gebruikersnaam kon niet worden opgehaald.', error);
  }
}

showWelcomeUsername();

const logoutButton = document.getElementById('logout-button');
logoutButton?.addEventListener('click', async () => {
  logoutButton.disabled = true;
  logoutButton.textContent = 'Bezig…';
  try {
    const response = await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(`Uitloggen mislukt (${response.status}).`);
    window.location.replace('/');
  } catch (error) {
    console.error('Uitloggen is niet gelukt.', error);
    logoutButton.disabled = false;
    logoutButton.textContent = 'Uitloggen';
    window.alert('Uitloggen is niet gelukt. Probeer het opnieuw.');
  }
});

function renderTrendChart(name, values, labels, valueFormatter) {
  const svg = document.querySelector(`[data-trend-chart="${name}"]`);
  if (!svg) return;

  const safeValues = values.map((value) => Number.isFinite(Number(value)) ? Number(value) : 0);
  const maxValue = Math.max(0, ...safeValues);
  const scaleMax = Math.max(1, maxValue);
  const left = 44;
  const right = 312;
  const top = 13;
  const bottom = 76;
  const points = safeValues.map((value, index) => ({
    x: left + index * (right - left) / Math.max(1, safeValues.length - 1),
    y: bottom - (value / scaleMax) * (bottom - top),
  }));
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const addSvgElement = (tag, attributes) => {
    const element = document.createElementNS(svgNamespace, tag);
    Object.entries(attributes).forEach(([attribute, value]) => element.setAttribute(attribute, value));
    svg.append(element);
    return element;
  };

  svg.replaceChildren();
  svg.setAttribute('aria-label', `${safeValues.length} weken: ${safeValues.map((value, index) => `${labels[index]} ${valueFormatter(value)}`).join(', ')}`);
  addSvgElement('line', { x1: left, x2: left, y1: top, y2: bottom, class: 'trend-axis' });
  addSvgElement('line', { x1: left, x2: right, y1: bottom, y2: bottom, class: 'trend-axis' });

  const compactFormat = new Intl.NumberFormat('nl-BE', { notation: 'compact', maximumFractionDigits: 1 });
  const axisFormat = (value) => name === 'profit'
    ? `€${compactFormat.format(value)}`
    : compactFormat.format(value);
  const yTicks = maxValue === 0
    ? [{ value: 0, y: bottom }]
    : [
      { value: maxValue, y: top },
      { value: maxValue / 2, y: (top + bottom) / 2 },
      { value: 0, y: bottom },
    ];
  yTicks.forEach(({ value, y }) => {
    addSvgElement('line', { x1: left - 3, x2: left, y1: y, y2: y, class: 'trend-axis' });
    const tickLabel = addSvgElement('text', {
      x: left - 6,
      y: y + 3,
      'text-anchor': 'end',
      class: 'trend-axis-tick',
    });
    tickLabel.textContent = axisFormat(value);
  });

  if (points.length > 0) {
    let path = `M ${points[0].x} ${points[0].y}`;
    if (points.length > 1) {
      const widths = points.slice(1).map((point, index) => point.x - points[index].x);
      const slopes = points.slice(1).map((point, index) => (point.y - points[index].y) / widths[index]);
      const tangents = new Array(points.length);
      const endpointTangent = (firstWidth, secondWidth, firstSlope, secondSlope) => {
        const tangent = ((2 * firstWidth + secondWidth) * firstSlope - firstWidth * secondSlope) /
          (firstWidth + secondWidth);
        if (Math.sign(tangent) !== Math.sign(firstSlope)) return 0;
        if (Math.sign(firstSlope) !== Math.sign(secondSlope) && Math.abs(tangent) > Math.abs(3 * firstSlope)) {
          return 3 * firstSlope;
        }
        return tangent;
      };

      if (points.length === 2) {
        tangents[0] = slopes[0];
        tangents[1] = slopes[0];
      } else {
        tangents[0] = endpointTangent(widths[0], widths[1], slopes[0], slopes[1]);
        tangents[points.length - 1] = endpointTangent(
          widths[widths.length - 1],
          widths[widths.length - 2],
          slopes[slopes.length - 1],
          slopes[slopes.length - 2],
        );

        for (let index = 1; index < points.length - 1; index += 1) {
          const previousSlope = slopes[index - 1];
          const nextSlope = slopes[index];
          if (previousSlope === 0 || nextSlope === 0 || Math.sign(previousSlope) !== Math.sign(nextSlope)) {
            tangents[index] = 0;
            continue;
          }
          const previousWidth = widths[index - 1];
          const nextWidth = widths[index];
          const firstWeight = 2 * nextWidth + previousWidth;
          const secondWeight = nextWidth + 2 * previousWidth;
          tangents[index] = (firstWeight + secondWeight) /
            (firstWeight / previousSlope + secondWeight / nextSlope);
        }
      }

      for (let index = 0; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        const width = widths[index];
        path += ` C ${current.x + width / 3} ${current.y + tangents[index] * width / 3}, ` +
          `${next.x - width / 3} ${next.y - tangents[index + 1] * width / 3}, ${next.x} ${next.y}`;
      }
    }
    addSvgElement('path', { d: path, class: `trend-line trend-${name}` });
  }

  [0, 0.25, 0.5, 0.75, 1]
    .map((position) => Math.round((labels.length - 1) * position))
    .filter((index, position, indexes) => indexes.indexOf(index) === position)
    .forEach((index, tickIndex, indexes) => {
      const point = points[index];
      if (!point) return;
      addSvgElement('line', { x1: point.x, x2: point.x, y1: bottom, y2: bottom + 3, class: 'trend-axis' });
      const tickLabel = addSvgElement('text', {
        x: point.x,
        y: 95,
        'text-anchor': tickIndex === 0 ? 'start' : tickIndex === indexes.length - 1 ? 'end' : 'middle',
        class: 'trend-axis-tick',
      });
      tickLabel.textContent = labels[index];
    });
}

async function loadDashboardStats() {
  const stats = document.getElementById('dashboard-stats');
  const message = document.getElementById('dashboard-stats-message');
  if (!stats || !message) return;

  const numberFormat = new Intl.NumberFormat('nl-BE');
  const currencyFormat = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
  const setStat = (name, value) => {
    const element = document.querySelector(`[data-dashboard-stat="${name}"]`);
    if (element) element.textContent = value;
  };

  try {
    const response = await fetch('/api/admin/dashboard', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Dashboarddata ophalen mislukt (${response.status}).`);

    const data = await response.json();
    setStat('requests-total', numberFormat.format(data.serviceRequests.total));
    setStat('requests-open', numberFormat.format(data.serviceRequests.open));
    setStat('requests-in-progress', numberFormat.format(data.serviceRequests.inProgress));
    setStat('requests-closed', numberFormat.format(data.serviceRequests.closed));
    setStat('revenue', currencyFormat.format(data.revenue.total));
    setStat('profit', data.revenue.profitAvailable ? currencyFormat.format(data.revenue.profit) : '—');
    setStat('users-total', numberFormat.format(data.users.total));

    const profitNote = document.getElementById('dashboard-profit-note');
    if (profitNote && !data.revenue.profitAvailable) {
      profitNote.textContent = 'Winst ontbreekt bij een of meer omzetregels';
    }

    const usersNote = document.getElementById('dashboard-users-note');
    if (usersNote) usersNote.textContent = `${numberFormat.format(data.users.customers)} klantaccounts`;

    const trendValues = {
      users: data.trends.users,
      requests: data.trends.requests,
      profit: data.trends.profit,
    };
    renderTrendChart('users', trendValues.users, data.trends.weeks, (value) => numberFormat.format(value));
    renderTrendChart('requests', trendValues.requests, data.trends.weeks, (value) => numberFormat.format(value));
    renderTrendChart('profit', trendValues.profit, data.trends.weeks, (value) => currencyFormat.format(value));

    message.hidden = true;
    stats.setAttribute('aria-busy', 'false');
    document.getElementById('dashboard-trends')?.setAttribute('aria-busy', 'false');
  } catch (error) {
    console.error('Dashboardgegevens konden niet worden geladen.', error);
    message.textContent = 'Dashboardgegevens konden niet worden geladen.';
    stats.setAttribute('aria-busy', 'false');
    document.getElementById('dashboard-trends')?.setAttribute('aria-busy', 'false');
  }
}

loadDashboardStats();

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function formatRequestDate(value) {
  if (value === null || value === undefined || value === '') return 'Datum onbekend';

  const numericValue = Number(value);
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue < 1e12 ? numericValue * 1000 : numericValue)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Datum onbekend';

  return new Intl.DateTimeFormat('nl-BE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatDateInput(value) {
  if (value === null || value === undefined || value === '') return '';
  const numericValue = Number(value);
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue < 1e12 ? numericValue * 1000 : numericValue)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function formatCalendarDate(value) {
  const dateValue = formatDateInput(value);
  if (!dateValue) return '';
  const [year, month, day] = dateValue.split('-').map(Number);
  return new Intl.DateTimeFormat('nl-BE', { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function renderAdminRequests(requests) {
  const list = document.getElementById('admin-request-list');
  const message = document.getElementById('admin-requests-message');
  if (!list || !message) return;

  list.replaceChildren();
  list.setAttribute('aria-busy', 'false');

  if (requests.length === 0) {
    message.textContent = 'Er zijn nog geen aanvragen.';
    message.hidden = false;
    return;
  }

  const statusLabels = {
    open: { label: 'Nieuw', className: 'new' },
    in_progress: { label: 'Bezig', className: 'waiting' },
    closed: { label: 'Klaar', className: 'done' },
  };

  requests.forEach((request) => {
    const card = createTextElement('article', 'admin-request-card', '');
    const heading = createTextElement('div', 'admin-request-heading', '');
    const details = createTextElement('div', '', '');
    const title = (typeof request.title === 'string' && request.title.trim())
      ? request.title.trim()
      : `Aanvraag #${request.id}`;
    details.append(createTextElement('h3', 'admin-request-title', title));
    details.append(createTextElement('p', 'admin-request-client', `Ingediend door ${request.username || 'onbekende gebruiker'}`));

    const actions = createTextElement('div', 'admin-request-actions', '');
    const statusInfo = statusLabels[request.status] || { label: request.status || 'Onbekend', className: '' };
    actions.append(createTextElement('span', `status ${statusInfo.className}`.trim(), statusInfo.label));

    const editButton = createTextElement('button', 'admin-request-edit', 'Bewerken');
    editButton.type = 'button';
    editButton.setAttribute('aria-label', `Aanvraag ${request.id} bewerken`);
    editButton.addEventListener('click', () => openRequestEditor(request));
    actions.append(editButton);
    const deleteButton = createTextElement('button', 'admin-request-delete', 'Verwijderen');
    deleteButton.type = 'button';
    deleteButton.setAttribute('aria-label', `Aanvraag ${request.id} verwijderen`);
    deleteButton.addEventListener('click', () => deleteAdminRecord(
      `/api/admin/requests/${encodeURIComponent(request.id)}`,
      `Aanvraag “${title}” verwijderen? Deze actie kan niet ongedaan worden gemaakt.`,
      () => Promise.all([loadAdminRequests(), loadDashboardStats()]),
      deleteButton
    ));
    actions.append(deleteButton);

    heading.append(details, actions);
    card.append(heading);

    const meta = createTextElement('div', 'admin-request-meta', '');
    meta.append(createTextElement('span', '', `Aanvraag #${request.id}`));
    meta.append(createTextElement('span', '', `Ingediend ${formatRequestDate(request.createdAt)}`));
    meta.append(createTextElement('span', '', `Dienst: ${serviceTypeLabels[request.serviceType] || 'Onbekend'}`));
    const isPaid = request.paymentCompleted === true || Number(request.paymentCompleted) === 1;
    if (isPaid) {
      meta.append(createTextElement('span', '', 'Betaald'));
      const paidDateLabel = formatCalendarDate(request.paymentDate);
      if (paidDateLabel) meta.append(createTextElement('span', '', `Betaald op ${paidDateLabel}`));
      if (request.paymentAmount !== null && request.paymentAmount !== undefined) {
        meta.append(createTextElement('span', '', `Opbrengst: ${paymentCurrencyFormat.format(Number(request.paymentAmount))}`));
      }
      if (request.paymentProfit !== null && request.paymentProfit !== undefined) {
        meta.append(createTextElement('span', '', `Winst: ${paymentCurrencyFormat.format(Number(request.paymentProfit))}`));
      }
    } else {
      meta.append(createTextElement('span', '', 'Niet betaald'));
    }
    card.append(meta);
    card.append(createTextElement('p', 'admin-request-description', request.description || 'Geen beschrijving toegevoegd.'));
    list.append(card);
  });

  message.hidden = true;
}

async function deleteAdminRecord(url, confirmation, refresh, button) {
  if (!window.confirm(confirmation)) return;
  button.disabled = true;
  try {
    const response = await fetch(url, { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Verwijderen is mislukt.');
    await refresh();
  } catch (error) {
    window.alert(error.message || 'Verwijderen is mislukt.');
  } finally {
    button.disabled = false;
  }
}

let originalPaymentCompletedForEdit = false;

function openRequestEditor(request) {
  const dialog = document.getElementById('admin-request-dialog');
  if (!dialog) return;

  originalPaymentCompletedForEdit = request.paymentCompleted === true || Number(request.paymentCompleted) === 1;
  document.getElementById('admin-edit-request-id').value = request.id;
  document.getElementById('admin-edit-request-title').value =
    (typeof request.title === 'string' && request.title.trim()) ? request.title.trim() : `Aanvraag #${request.id}`;
  document.getElementById('admin-edit-request-description').value = request.description || '';
  document.getElementById('admin-edit-request-status').value = request.status || 'open';
  document.getElementById('admin-edit-request-service-type').value = request.serviceType || 'other';
  document.getElementById('admin-edit-request-payment-completed').value = originalPaymentCompletedForEdit ? 'true' : 'false';
  document.getElementById('admin-edit-request-payment-date').value = formatDateInput(request.paymentDate);
  document.getElementById('admin-edit-request-payment-amount').value = request.paymentAmount ?? '';
  document.getElementById('admin-edit-request-payment-profit').value = request.paymentProfit ?? '';
  syncPaymentFields();
  document.getElementById('admin-edit-request-notes').value = request.adminNotes || '';
  document.getElementById('admin-request-edit-message').textContent = '';
  dialog.showModal();
  document.getElementById('admin-edit-request-title').focus();
}

const requestEditDialog = document.getElementById('admin-request-dialog');
const requestEditForm = document.getElementById('admin-request-form');
const requestStatusSelect = document.getElementById('admin-edit-request-status');
const paymentSection = document.getElementById('admin-payment-section');
const paymentCompletedSelect = document.getElementById('admin-edit-request-payment-completed');
const paymentDateInput = document.getElementById('admin-edit-request-payment-date');
const paymentFields = document.getElementById('admin-payment-fields');
const paymentAmountInput = document.getElementById('admin-edit-request-payment-amount');
const paymentProfitInput = document.getElementById('admin-edit-request-payment-profit');
function syncPaymentFields() {
  if (!requestStatusSelect || !paymentCompletedSelect || !paymentSection || !paymentFields) return;
  const canEditPayment = requestStatusSelect.value === 'closed';
  const isPaid = paymentCompletedSelect.value === 'true';
  paymentSection.hidden = !canEditPayment;
  paymentFields.hidden = !canEditPayment || !isPaid;
  [paymentDateInput, paymentAmountInput, paymentProfitInput].forEach((input) => {
    if (!input) return;
    input.disabled = !canEditPayment || !isPaid;
    input.required = canEditPayment && isPaid;
  });
}
requestStatusSelect?.addEventListener('change', () => {
  if (requestStatusSelect.value !== 'closed' && paymentCompletedSelect) {
    paymentCompletedSelect.value = originalPaymentCompletedForEdit ? 'true' : 'false';
  }
  syncPaymentFields();
});
paymentCompletedSelect?.addEventListener('change', syncPaymentFields);
syncPaymentFields();

if (requestEditForm && requestEditDialog) {
  document.getElementById('admin-request-cancel').addEventListener('click', () => requestEditDialog.close());
  requestEditForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveButton = document.getElementById('admin-request-save');
    const message = document.getElementById('admin-request-edit-message');
    const requestId = document.getElementById('admin-edit-request-id').value;
    const payload = {
      title: document.getElementById('admin-edit-request-title').value,
      description: document.getElementById('admin-edit-request-description').value,
      status: document.getElementById('admin-edit-request-status').value,
      serviceType: document.getElementById('admin-edit-request-service-type').value,
      paymentCompleted: document.getElementById('admin-edit-request-payment-completed').value === 'true',
      paymentDate: document.getElementById('admin-edit-request-payment-date').value,
      paymentAmount: document.getElementById('admin-edit-request-payment-amount').value,
      paymentProfit: document.getElementById('admin-edit-request-payment-profit').value,
      adminNotes: document.getElementById('admin-edit-request-notes').value,
    };

    saveButton.disabled = true;
    message.textContent = 'Aanvraag opslaan…';
    try {
      const response = await fetch(`/api/admin/requests/${encodeURIComponent(requestId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'De aanvraag kon niet worden opgeslagen.');

      requestEditDialog.close();
      await Promise.all([loadAdminRequests(), loadDashboardStats()]);
    } catch (error) {
      message.textContent = error.message || 'De aanvraag kon niet worden opgeslagen.';
    } finally {
      saveButton.disabled = false;
    }
  });
}

async function loadAdminRequests() {
  const list = document.getElementById('admin-request-list');
  const message = document.getElementById('admin-requests-message');
  if (!list || !message) return;

  try {
    const response = await fetch('/api/admin/requests', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Aanvragen ophalen mislukt (${response.status}).`);

    const data = await response.json();
    if (!Array.isArray(data.requests)) throw new Error('Ongeldige lijst met aanvragen ontvangen.');
    renderAdminRequests(data.requests);
  } catch (error) {
    console.error('Aanvragen konden niet worden geladen.', error);
    list.replaceChildren();
    list.setAttribute('aria-busy', 'false');
    message.textContent = 'De aanvragen konden niet worden geladen.';
    message.hidden = false;
  }
}

loadAdminRequests();

const dashboardPageButtons = document.querySelectorAll('[data-dashboard-page]');
const dashboardViews = document.querySelectorAll('[data-dashboard-view]');

dashboardPageButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const selectedPage = button.dataset.dashboardPage;

    dashboardPageButtons.forEach((pageButton) => {
      pageButton.setAttribute('aria-pressed', String(pageButton === button));
    });

    dashboardViews.forEach((view) => {
      view.hidden = view.dataset.dashboardView !== selectedPage;
    });
  });
});

const accountPasswordForm = document.getElementById('account-password-form');
accountPasswordForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = document.getElementById('account-password-message');
  const currentPassword = accountPasswordForm.elements.namedItem('currentPassword').value;
  const newPassword = accountPasswordForm.elements.namedItem('newPassword').value;
  const confirmPassword = accountPasswordForm.elements.namedItem('confirmPassword').value;
  const submitButton = accountPasswordForm.querySelector('button[type="submit"]');
  const setPasswordMessage = (text, type = '') => {
    message.textContent = text;
    message.classList.remove('success', 'error');
    if (type) message.classList.add(type);
  };

  if (newPassword !== confirmPassword) {
    setPasswordMessage('De nieuwe wachtwoorden komen niet overeen.', 'error');
    return;
  }

  submitButton.disabled = true;
  setPasswordMessage('Wachtwoord wordt aangepast…');
  try {
    const response = await fetch('/api/account/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Het wachtwoord kon niet worden aangepast.');

    accountPasswordForm.reset();
    setPasswordMessage('Je wachtwoord is aangepast. Andere sessies zijn afgemeld.', 'success');
  } catch (error) {
    setPasswordMessage(error.message || 'Geen verbinding met de server.', 'error');
  } finally {
    submitButton.disabled = false;
  }
});
