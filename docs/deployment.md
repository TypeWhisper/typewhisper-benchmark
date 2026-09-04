# Recorder Service Deployment

The production service combines the recording room, run intake, and result
visualizer. It binds to `192.168.199.253:4192`; the reverse proxy terminates TLS
for `typewhisper-benchmark.hlab.cloud`.

Run the installer from the repository root:

```bash
./scripts/install-recorder-service.sh
```

The installer builds TypeScript, creates an immutable release under
`/home/marco/.local/share/typewhisper-benchmark/releases`, atomically updates
the `current` symlink, installs the user systemd service, and waits for the
health endpoint.

Persistent recordings, pending uploads, and published snapshots live under
`/home/marco/.local/state/typewhisper-benchmark`. Credentials live in the
mode-0600 file `/home/marco/.config/typewhisper-benchmark/app.env` and are
preserved across deployments. Do not copy credentials into the repository.

Useful checks:

```bash
systemctl --user status typewhisper-benchmark.service
curl http://192.168.199.253:4192/api/health
curl -I https://typewhisper-benchmark.hlab.cloud/
```
