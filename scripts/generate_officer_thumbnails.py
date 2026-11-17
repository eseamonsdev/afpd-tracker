"""Create small WebP thumbnails for primary officer portraits stored in R2.

Only immediate children of officer-photos/ named *-photo.<image extension>
are treated as primary portraits. Originals and other photo folders are untouched.
"""

import hashlib
import io
import json
import re

from PIL import Image, ImageOps, UnidentifiedImageError

from r2_audio import client_and_bucket


SOURCE_PREFIX = "officer-photos/"
THUMBNAIL_PREFIX = SOURCE_PREFIX + "thumbnails/"
SOURCE_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-photo\.(?:jpe?g|png|webp)$", re.I)
SIZE = (96, 96)
VERSION = "square-v1"


def thumbnail_key(source_key):
    name = source_key.removeprefix(SOURCE_PREFIX)
    if "/" in name or not SOURCE_NAME.fullmatch(name):
        return None
    stem = name.rsplit(".", 1)[0].removesuffix("-photo")
    return THUMBNAIL_PREFIX + stem + "-thumbnail.webp"


def render_thumbnail(content):
    try:
        with Image.open(io.BytesIO(content)) as source:
            source = ImageOps.exif_transpose(source)
            # Slightly high crop retains the face and shoulders in tall portraits.
            portrait = ImageOps.fit(
                source.convert("RGB"), SIZE, method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.25),
            )
            output = io.BytesIO()
            portrait.save(output, format="WEBP", quality=80, method=6)
            return output.getvalue()
    except (UnidentifiedImageError, OSError) as error:
        raise ValueError("Could not decode officer portrait") from error


def generate(client, bucket):
    counts = {"created": 0, "updated": 0, "unchanged": 0, "skipped": 0}
    for page in client.get_paginator("list_objects_v2").paginate(
        Bucket=bucket, Prefix=SOURCE_PREFIX, Delimiter="/"
    ):
        for item in page.get("Contents", []):
            source_key = item["Key"]
            target_key = thumbnail_key(source_key)
            if not target_key:
                if source_key != SOURCE_PREFIX:
                    counts["skipped"] += 1
                    print("Skipping non-portrait root object:", source_key)
                continue

            etag = item["ETag"].strip('"')
            try:
                existing = client.head_object(Bucket=bucket, Key=target_key)
            except Exception as error:
                code = getattr(error, "response", {}).get("Error", {}).get("Code")
                if code not in ("404", "NoSuchKey", "NotFound"):
                    raise
                existing = None

            if existing and existing.get("Metadata", {}).get("source-etag") == etag \
                    and existing["Metadata"].get("generator-version") == VERSION:
                counts["unchanged"] += 1
                continue

            response = client.get_object(Bucket=bucket, Key=source_key)
            try:
                content = response["Body"].read()
            finally:
                response["Body"].close()
            thumbnail = render_thumbnail(content)
            digest = hashlib.sha256(thumbnail).hexdigest()
            client.put_object(
                Bucket=bucket, Key=target_key, Body=thumbnail,
                ContentType="image/webp",
                CacheControl="public, max-age=86400",
                Metadata={
                    "source-etag": etag,
                    "generator-version": VERSION,
                    "sha256": digest,
                },
            )
            check = client.get_object(Bucket=bucket, Key=target_key)
            try:
                downloaded = check["Body"].read()
            finally:
                check["Body"].close()
            if hashlib.sha256(downloaded).hexdigest() != digest:
                raise ValueError("Thumbnail read-back mismatch: " + target_key)
            status = "updated" if existing else "created"
            counts[status] += 1
            print(status.capitalize() + ":", target_key, len(thumbnail), "bytes")
    return counts


if __name__ == "__main__":
    r2, r2_bucket = client_and_bucket()
    print(json.dumps({"bucket": r2_bucket, **generate(r2, r2_bucket)}))
