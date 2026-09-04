# Recorder Service Deployment

The production service combines the recording room, run intake, and result
visualizer. Its bind address and public hostname are deployment-specific; the
reverse proxy terminates TLS and supplies the access protection. The application
deliberately does not add a second username/password prompt.

Run the installer from the repository root:

```bash
./scripts/install-recorder-service.sh
```

The installer builds TypeScript, creates an immutable release under
`/home/marco/.local/share/typewhisper-benchmark/releases`, atomically updates
the `current` symlink, installs the user systemd service, and waits for the
health endpoint.

Persistent recordings, pending uploads, and published snapshots live under
`/home/marco/.local/state/typewhisper-benchmark`. The non-secret runtime settings
are packaged with each release and loaded from
`/home/marco/.local/share/typewhisper-benchmark/current/app.env`. Access control
belongs to the reverse proxy and must not be duplicated here.

Useful checks:

```bash
systemctl --user status typewhisper-benchmark.service
curl http://127.0.0.1:4192/api/health
curl -I https://benchmark.example.com/
```
