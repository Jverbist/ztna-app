#!/usr/bin/env bash
# Generates a self-signed TLS certificate for the local demo domain
# ztna.demo.local. Run this once on the Ubuntu VM before `docker compose up`.
set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"
DOMAIN="ztna.demo.local"

mkdir -p "${CERT_DIR}"

openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "${CERT_DIR}/${DOMAIN}.key" \
  -out "${CERT_DIR}/${DOMAIN}.crt" \
  -subj "/C=BE/O=ZTNA Demo/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN}"

echo "Self-signed certificate created at ${CERT_DIR}"
echo "Remember to add '172.16.1.2 ${DOMAIN}' to the hosts file of any client machine that will browse to it."
