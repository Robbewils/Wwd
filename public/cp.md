
$source = "C:\Users\RobbeWils\OneDrive - KOBA VZW\thuis\WebsiteDevelopment\Wilcotec\Testwebsites\Main_Page"
$destination = "C:\Users\RobbeWils\OneDrive - KOBA VZW\thuis\WebsiteDevelopment\Wilcotec\Testwebsites\Main_Page_3"

# Controleer of de bronmap bestaat
if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    Write-Error "De bronmap bestaat niet: $source"
    return
}

# Maak de doelmap aan indien nodig
New-Item -ItemType Directory -Path $destination -Force | Out-Null

# Kopieer alle bestanden en submappen, inclusief verborgen bestanden
Get-ChildItem -LiteralPath $source -Force |
    Copy-Item -Destination $destination -Recurse -Force

Write-Host "Kopiëren voltooid!" -ForegroundColor Green
Write-Host "Bron: $source"
Write-Host "Doel: $destination"
