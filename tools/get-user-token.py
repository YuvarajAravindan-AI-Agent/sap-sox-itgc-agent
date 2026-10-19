#!/usr/bin/env python3
"""Get a user token for the deployed control service, using the one-time passcode flow, and save it (mode 600) for scripted calls.
The passcode is typed by the user at a hidden prompt; the token is never printed. Needs: cf CLI logged in, service key sox-test-key.
  python3 tools/get-user-token.py        then open the printed passcode URL, sign in, copy the code."""
import base64, getpass, json, os, subprocess, sys, urllib.parse, urllib.request
raw = subprocess.run(['cf', 'service-key', 'sap-sox-itgc-agent-auth', 'sox-test-key'], capture_output=True, text=True).stdout
k = json.loads(raw[raw.index('{'):]); k = k.get('credentials', k)
print('Open this page, sign in, copy the temporary code:\n  ' + k['url'] + '/passcode')
code = getpass.getpass('Passcode (hidden): ').strip()
body = urllib.parse.urlencode({'grant_type': 'password', 'passcode': code}).encode()
req = urllib.request.Request(k['url'] + '/oauth/token', data=body, headers={'Authorization': 'Basic ' + base64.b64encode((k['clientid'] + ':' + k['clientsecret']).encode()).decode(), 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'})
try: tok = json.load(urllib.request.urlopen(req))
except urllib.error.HTTPError as e: sys.exit('token request failed: %s %s' % (e.code, e.read().decode()[:200]))
path = os.path.expanduser('~/.cache/sox-user-token.json'); os.makedirs(os.path.dirname(path), exist_ok=True)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f: json.dump({'access_token': tok['access_token'], 'scope': tok.get('scope')}, f)
print('OK: token saved to', path, '| scopes:', ', '.join(s.split('.')[-1] for s in tok.get('scope', '').split()))
