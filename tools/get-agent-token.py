#!/usr/bin/env python3
"""Client-credentials token (scope agent only) for the deployed control service, saved 0600 and never printed. For demos and checks run from the laptop.
Needs: cf CLI logged in, service key sox-test-key on sap-sox-itgc-agent-auth."""
import base64, json, os, subprocess, urllib.parse, urllib.request
raw = subprocess.run(['cf', 'service-key', 'sap-sox-itgc-agent-auth', 'sox-test-key'], capture_output=True, text=True).stdout
k = json.loads(raw[raw.index('{'):]); k = k.get('credentials', k)
req = urllib.request.Request(k['url'] + '/oauth/token', data=b'grant_type=client_credentials', headers={'Authorization': 'Basic ' + base64.b64encode((k['clientid'] + ':' + k['clientsecret']).encode()).decode(), 'Content-Type': 'application/x-www-form-urlencoded'})
tok = json.load(urllib.request.urlopen(req))
path = os.path.expanduser('~/.cache/sox-agent-token.json'); os.makedirs(os.path.dirname(path), exist_ok=True)
with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f: json.dump({'access_token': tok['access_token']}, f)
print('OK: agent-scope token saved to', path, '| scope:', tok.get('scope', '').replace(k.get('xsappname', ''), '').strip())
