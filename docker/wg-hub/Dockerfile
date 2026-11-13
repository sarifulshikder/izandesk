FROM alpine:3.20
RUN apk add --no-cache wireguard-tools iproute2 iptables bash inotify-tools net-snmp-tools
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
VOLUME ["/etc/wireguard"]
ENTRYPOINT ["/entrypoint.sh"]
