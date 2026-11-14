#!/usr/bin/env bash
set -euo pipefail

IFACE="${WG_INTERFACE:-wg0}"
CONF="/etc/wireguard/${IFACE}.conf"
STATUS="/etc/wireguard/status.json"

write_status() {
  if command -v wg >/dev/null 2>&1; then
    local raw peers json
    raw=$(wg show all dump 2>/dev/null || true)
    # build simple json array of peer lines
    peers="[]"
    if [ -n "$raw" ]; then
      peers=$(printf '%s\n' "$raw" | awk -F'\t' 'NF>=8 {gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); printf("%s{\"interface\":\"%s\",\"public_key\":\"%s\",\"preshared_key\":\"%s\",\"endpoint\":\"%s\",\"allowed_ips\":\"%s\",\"latest_handshake\":%s,\"rx_bytes\":%s,\"tx_bytes\":%s,\"keepalive\":%s}", (c?",":""), $1,$2,$3,$4,$5,($6+0),($7+0),($8+0),(($9=="")?"null":($9+0))); c=1} END{}')
      peers="[${peers}]"
    fi
    printf '{"ts":%s,"peers":%s,"raw":%s}\n' "$(date +%s)" "$peers" "$(printf '%s' "$raw" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '""')" > "$STATUS.tmp" 2>/dev/null && mv "$STATUS.tmp" "$STATUS" || true
  fi
}



apply_radius_forward() {
  # Forward RADIUS from tunnel hub IP to freeradius container (same docker network)
  local fr
  fr=$(getent hosts izandesk-freeradius 2>/dev/null | awk '{print $1}' | head -1 || true)
  [ -z "$fr" ] && return 0
  iptables -t nat -C PREROUTING -i "$IFACE" -d 10.77.0.1 -p udp --dport 1812 -j DNAT --to-destination ${fr}:1812 2>/dev/null || iptables -t nat -A PREROUTING -i "$IFACE" -d 10.77.0.1 -p udp --dport 1812 -j DNAT --to-destination ${fr}:1812 || true
  iptables -t nat -C PREROUTING -i "$IFACE" -d 10.77.0.1 -p udp --dport 1813 -j DNAT --to-destination ${fr}:1813 2>/dev/null || iptables -t nat -A PREROUTING -i "$IFACE" -d 10.77.0.1 -p udp --dport 1813 -j DNAT --to-destination ${fr}:1813 || true
  iptables -t nat -C POSTROUTING -d ${fr} -p udp -m multiport --dports 1812,1813 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -d ${fr} -p udp -m multiport --dports 1812,1813 -j MASQUERADE || true
}

apply_tunnel_nat() {
  # Allow other containers (e.g. API) to reach tunnel peers/OLT mgmt subnets via wg-hub
  iptables -t nat -C POSTROUTING -o "$IFACE" -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE || true
}

apply_olt_routes() {
  local routes="/etc/wireguard/olt_routes.txt"
  [ -f "$routes" ] || return 0
  while IFS= read -r cidr; do
    cidr="${cidr%%#*}"; cidr="$(echo "$cidr" | xargs || true)"
    [ -z "$cidr" ] && continue
    ip route replace "$cidr" dev "$IFACE" 2>/dev/null || true
  done < "$routes"
}

apply_conf() {
  if [ ! -f "$CONF" ]; then
    echo "[wg-hub] waiting for config: $CONF"
    return 0
  fi
  echo "[wg-hub] applying $CONF"
  if ip link show "$IFACE" >/dev/null 2>&1; then
    wg syncconf "$IFACE" <(wg-quick strip "$IFACE") 2>/dev/null || { wg-quick down "$IFACE" 2>/dev/null || true; wg-quick up "$IFACE"; }
  else
    wg-quick up "$IFACE" || wg-quick up "$CONF" || true
  fi
  apply_olt_routes || true
  apply_radius_forward || true
  apply_tunnel_nat || true
}

mkdir -p /etc/wireguard
apply_conf || true
write_status || true

echo "[wg-hub] watching $CONF for changes and publishing status"
while true; do
  inotifywait -e close_write,create,move,attrib -t 10 /etc/wireguard >/dev/null 2>&1 || true
  sleep 1
  apply_conf || echo "[wg-hub] apply failed"
  apply_olt_routes || true
  apply_radius_forward || true
  apply_tunnel_nat || true
  write_status || true
done
