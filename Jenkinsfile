set -eu

cleanup() {
  sudo -n systemctl stop llama-server >/dev/null 2>&1 || true
}
trap 'cleanup' EXIT INT TERM

echo "Starting llama-server..."
sudo -n systemctl start llama-server

echo "Waiting for readiness..."
i=0
code="000"
while [ "$i" -lt 60 ]; do
  code=$(curl -s -o /tmp/llh-agent-smith-summary.json -w '%{http_code}' http://127.0.0.1:8081/health || true)
  if [ "$code" = "200" ]; then
    echo "Ready after ${i}s"
    break
  fi
  i=$((i + 1))
  sleep 1
done

if [ "$code" != "200" ]; then
  echo "llama-server not ready in time (last code: $code)"
  cat /tmp/llh-agent-smith-summary.json || true
  exit 1
fi

cd /var/lib/jenkins/

export API_URL="${API_URL:-http://127.0.0.1:3000}"
export AGENT_SMITH_SUMMARY_HOURS="${AGENT_SMITH_SUMMARY_HOURS:-24}"
export AGENT_SMITH_OUTPUT_DIR="${AGENT_SMITH_OUTPUT_DIR:-/tmp/agent-smith-summaries-${USER:-jenkins}}"
mkdir -p "$AGENT_SMITH_OUTPUT_DIR"
echo "Using AGENT_SMITH_OUTPUT_DIR=$AGENT_SMITH_OUTPUT_DIR"

echo "Running Agent Smith summary pipeline..."
if node agent_smith/review-agent-smith-events.mjs && node agent_smith/save-agent-smith-summary.mjs; then
  echo "Agent Smith summary pipeline completed successfully."
else
  echo "Agent Smith summary pipeline failed, failing build."
  exit 1
fi

echo "Done. llama-server will be stopped by trap."
