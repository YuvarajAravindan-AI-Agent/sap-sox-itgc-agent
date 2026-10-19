// One-off, run as a Cloud Foundry task of the control service: registers the control service as the subaccount destination
// SoxControlService, authenticating with the control service's own XSUAA client (its binding), so the credentials never leave
// the platform and are never typed or printed.
//   cf run-task sap-sox-itgc-agent-srv --command "node -e \"require('./srv/setup-destination').run('https://<srv-host>/controls')\""
async function run(controlsUrl, name = 'SoxControlService') {
  const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}')
  const dest = vcap.destination?.[0]?.credentials, xs = vcap.xsuaa?.[0]?.credentials
  if (!dest || !xs) throw new Error('needs destination and xsuaa bindings')
  const tokenResp = await fetch(dest.url + '/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${dest.clientid}:${dest.clientsecret}`).toString('base64') },
    body: 'grant_type=client_credentials'
  })
  if (!tokenResp.ok) throw new Error('destination token failed ' + tokenResp.status)
  const headers = { Authorization: 'Bearer ' + (await tokenResp.json()).access_token, 'Content-Type': 'application/json' }
  const body = {
    Name: name, Type: 'HTTP', URL: controlsUrl, ProxyType: 'Internet', Authentication: 'OAuth2ClientCredentials',
    clientId: xs.clientid, clientSecret: xs.clientsecret, tokenServiceURL: xs.url + '/oauth/token', tokenServiceURLType: 'Dedicated',
    Description: 'SOX control service (runControl, listControls), called by the chat agent with agent scope'
  }
  const api = `${dest.uri}/destination-configuration/v1/subaccountDestinations`
  let r = await fetch(api, { method: 'POST', headers, body: JSON.stringify(body) })
  let action = 'created'
  if (r.status === 409) { r = await fetch(api, { method: 'PUT', headers, body: JSON.stringify(body) }); action = 'updated' }
  const out = { destination: name, url: controlsUrl, action, status: r.status }
  console.log('DESTSETUP ' + JSON.stringify(out))
  if (!r.ok) throw new Error('destination write failed ' + r.status)
  return out
}

module.exports = { run }
