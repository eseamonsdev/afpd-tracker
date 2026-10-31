"""Build and publish the single 6001 listening-review HTML object to AFPD R2."""
import hashlib
from pathlib import Path
import subprocess
from urllib.request import Request, urlopen
from urllib.error import HTTPError

KEY = 'officer-association-review.html'
PUBLIC_URL = 'https://media.afpd-accountability.com/' + KEY


def publish_review(root, client, bucket, verify_public=True):
    if bucket != 'afpd-public-media':
        raise ValueError('Association review must use afpd-public-media')
    root = Path(root).resolve()
    subprocess.run(['node', str(root / 'scripts/build_association_review.mjs'), str(root)], check=True)
    content = (root / 'public' / KEY).read_bytes()
    if not content.startswith(b'<!doctype html>'):
        raise ValueError('Review page is not HTML')
    digest = hashlib.sha256(content).hexdigest()
    client.put_object(Bucket=bucket, Key=KEY, Body=content,
                      ContentType='text/html; charset=utf-8', CacheControl='no-store',
                      Metadata={'sha256': digest})
    response = client.get_object(Bucket=bucket, Key=KEY)
    body = response['Body']
    try:
        saved = body.read(len(content) + 1)
    finally:
        body.close()
    if saved != content:
        raise ValueError('R2 association review read-back mismatch')
    public_verified = False
    if verify_public:
        request = Request(PUBLIC_URL + '?version=' + digest[:16], headers={'Cache-Control': 'no-cache'})
        try:
            with urlopen(request, timeout=30) as response:
                if response.headers.get_content_type() != 'text/html' or response.read(len(content) + 1) != content:
                    raise ValueError('Public association review differs from the saved page')
                public_verified = True
        except HTTPError as error:
            if error.code != 403:
                raise
            print('Public URL check returned HTTP 403 for this runner; R2 bytes were verified. Verify the page in a browser.', flush=True)
    print('Association review uploaded and R2-verified:', PUBLIC_URL, flush=True)
    return {'key': KEY, 'url': PUBLIC_URL, 'sha256': digest, 'size_bytes': len(content), 'public_verified': public_verified}
