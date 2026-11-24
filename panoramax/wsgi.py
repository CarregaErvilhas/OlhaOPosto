"""WSGI entry point for gunicorn: the Panoramax API with our own proxy trust.

Panoramax's INFRA_NB_PROXIES applies one count to all five X-Forwarded-*
headers, which is wrong for us (seen on the zerops.app subdomain, Docs/infra.md section 7):

- The Zerops balancer sets Host, Proto and Port, but passes a client's
  X-Forwarded-Prefix through untouched. Trusting Prefix lets any client
  rewrite the links in API responses.
- It sends X-Forwarded-Port: 80 even on HTTPS, so links came out
  https://host:80/...
- Cloudflare adds no X-Forwarded-Host, so a count of 2 behind it would read
  a client-supplied Host instead of the balancer's.

So INFRA_NB_PROXIES stays unset (Panoramax installs no ProxyFix) and this
module trusts only the last hop, the balancer, for For, Proto and Host. That
is correct both on the zerops.app subdomain and behind Cloudflare.
"""

from werkzeug.middleware.proxy_fix import ProxyFix

from geovisio import create_api

app = create_api()
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=0, x_prefix=0)
