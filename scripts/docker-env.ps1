$dockerBin = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin"

if (Test-Path $dockerBin) {
  $env:PATH = "$dockerBin;$env:PATH"
  $env:MLAGENT_DOCKER_EXE = Join-Path $dockerBin "docker.exe"
  Write-Output "Docker CLI configured: $env:MLAGENT_DOCKER_EXE"
} else {
  Write-Error "Docker Desktop CLI directory not found: $dockerBin"
  exit 1
}
