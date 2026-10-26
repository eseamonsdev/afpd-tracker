"""Verify the configured bucket by writing and reading one harmless probe object."""
import hashlib
import json
import os
import uuid


def main():
    required = ('R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_ENDPOINT')
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise SystemExit('Missing GitHub Actions settings: ' + ', '.join(missing))
    from urllib.parse import urlparse
    endpoint = urlparse(os.environ['R2_ENDPOINT'])
    if endpoint.scheme != 'https' or not (endpoint.hostname or '').endswith('.r2.cloudflarestorage.com') or endpoint.path not in ('', '/'):
        raise SystemExit('R2_ENDPOINT must be the HTTPS S3 endpoint, without a bucket path')
    import boto3
    from botocore.config import Config
    client = boto3.client('s3', endpoint_url=os.environ['R2_ENDPOINT'], region_name='auto',
                          aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                          aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
                          config=Config(retries={'max_attempts': 2}, connect_timeout=15, read_timeout=30))
    bucket = os.environ['R2_BUCKET_NAME']
    client.list_objects_v2(Bucket=bucket, MaxKeys=1)
    body = b'AFPD GitHub Actions R2 connection verification\n'
    key = '_connection-tests/github-' + uuid.uuid4().hex + '.txt'
    client.put_object(Bucket=bucket, Key=key, Body=body, ContentType='text/plain',
                      Metadata={'sha256': hashlib.sha256(body).hexdigest()})
    response = client.get_object(Bucket=bucket, Key=key)
    if response['Body'].read() != body:
        raise SystemExit('R2 read-back verification failed')
    client.delete_object(Bucket=bucket, Key=key)
    print(json.dumps({'bucket': bucket, 'list': 'passed', 'write': 'passed',
                      'read_back': 'passed', 'probe_key': key, 'probe_removed': True}))


if __name__ == '__main__':
    main()
