#!/bin/sh
# Installazione sul VPS dedicato Ubuntu 24.04; non abilita il backup.
set -eu
test "$(id -u)" = 0
. /etc/os-release
test "$ID" = ubuntu
test "$VERSION_ID" = 24.04
test "$(dpkg --print-architecture)" = amd64

# Attendere la fine del provisioning Aruba, senza ignorare i lock apt.
if [ "$(systemctl show cloud-final.service -p SubState --value)" = running ] \
    || [ ! -f /var/lib/cloud/instance/boot-finished ]; then
    echo 'Inizializzazione Aruba ancora in corso; riprovare al termine.' >&2
    exit 1
fi
# Il template IT1 osservato contiene resizelvm non eseguibile, con un nome LV
# obsoleto. Non eseguirlo: disabilitare solo quel comando quando il volume root
# occupa gia' almeno il 98% del disco. Un futuro ampliamento richiede verifica.
python3 - <<'PY'
import os
from pathlib import Path
import subprocess
from cloudinit import util
cfg = util.read_conf_with_confd('/etc/cloud/cloud.cfg')
legacy = Path('/usr/bin/resizelvm')
if cfg.get('bootcmd') == [['/usr/bin/resizelvm']] and not os.access(legacy, os.X_OK):
    root = subprocess.check_output(['findmnt', '-n', '-o', 'SOURCE', '/'], text=True).strip()
    if root != '/dev/mapper/lv-root':
        raise SystemExit('Layout root diverso: verificare il template prima di procedere.')
    volume_bytes = int(subprocess.check_output(['lsblk', '-bn', '-o', 'SIZE', root], text=True).strip())
    disk_bytes = int(subprocess.check_output(['lsblk', '-bdn', '-o', 'SIZE', '/dev/sda'], text=True).strip())
    if volume_bytes < disk_bytes * 0.98:
        raise SystemExit('Volume non espanso: non disabilitare il comando di resize.')
    override = Path('/etc/cloud/cloud.cfg.d/98-mirox-backup-no-legacy-resize.cfg')
    override.write_text('# Root gia espanso; resize legacy Aruba non valido.\nbootcmd: []\n')
    override.chmod(0o644)
    assert util.read_conf_with_confd('/etc/cloud/cloud.cfg').get('bootcmd') == []
    print('Resize legacy non eseguibile disabilitato; disco root gia espanso.')
PY
export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=90 update
apt-get -o DPkg::Lock::Timeout=90 install -y curl ca-certificates gnupg git unzip python3-venv unattended-upgrades

install -d -m 0755 /usr/share/postgresql-common/pgdg
curl --fail --silent --show-error --location \
    --connect-timeout 15 --max-time 120 \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
# Fingerprint ufficiale PGDG; apt mantiene la verifica delle firme dei pacchetti.
gpg --show-keys --with-colons /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    | awk -F: '$1 == "fpr" {print $10}' \
    | grep -qx B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
cat > /etc/apt/sources.list.d/pgdg.sources <<'EOF'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: noble-pgdg
Architectures: amd64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
EOF
apt-get -o DPkg::Lock::Timeout=90 update
apt-get -o DPkg::Lock::Timeout=90 install -y postgresql-client-17
apt-get -o DPkg::Lock::Timeout=90 -o Dpkg::Options::=--force-confold upgrade --with-new-pkgs -y

if ! id mirox-backup >/dev/null 2>&1; then
    useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin mirox-backup
fi
install -d -m 0755 /opt/mirox-backup
install -d -m 0700 /etc/mirox-backup
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52mirox-backup-reboot <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
EOF
systemctl enable --now apt-daily.timer apt-daily-upgrade.timer
pg_dump --version
python3 --version
echo 'Dipendenze installate; timer backup ancora disabilitato.'
