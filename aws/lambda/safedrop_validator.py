"""
AWS Lambda — SafeDrop validator (S3 event triggered).

Wire this to the S3 bucket's `s3:ObjectCreated:*` event notification. It runs the
same validation logic as the preview backend (`scan_file` in server.py), then
updates the item's safetyStatus in DynamoDB.

Deploy: package with boto3 (bundled in the Lambda runtime). Grant s3:GetObject on
the upload prefix and dynamodb:UpdateItem on the metadata table (see iam/).
"""
import os
import hashlib
import urllib.parse
import boto3

s3 = boto3.client("s3")
ddb = boto3.resource("dynamodb")
TABLE = ddb.Table(os.environ["METADATA_TABLE"])

MAX_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 25 * 1024 * 1024))
ALLOWED_EXT = {"pdf", "png", "jpg", "jpeg", "gif", "webp", "doc", "docx",
               "txt", "csv", "zip", "xls", "xlsx", "ppt", "pptx", "md", "json"}
DANGEROUS_EXT = {"exe", "bat", "sh", "cmd", "com", "msi", "jar", "scr", "vbs",
                 "dll", "ps1", "app", "deb", "apk", "bin", "cgi", "php", "js"}
SUSPICIOUS = ["..", "\x00", "<script", "%00"]


def validate(filename: str, data: bytes, content_type: str):
    parts = (filename or "").lower().split(".")
    ext = parts[-1] if len(parts) > 1 else ""
    ok = (
        len(data) > 0
        and len(data) <= MAX_BYTES
        and ext in ALLOWED_EXT
        and ext not in DANGEROUS_EXT
        and not any(t in (filename or "") for t in SUSPICIOUS)
        and not any(p in DANGEROUS_EXT for p in parts[1:])
    )
    return ("verified" if ok else "rejected", hashlib.sha256(data).hexdigest())


def handler(event, context):
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        obj = s3.get_object(Bucket=bucket, Key=key)
        data = obj["Body"].read()
        meta = obj.get("Metadata", {})
        filename = meta.get("original-filename", key.split("/")[-1])
        status, file_hash = validate(filename, data, obj.get("ContentType", ""))

        TABLE.update_item(
            Key={"objectKey": key},
            UpdateExpression="SET safetyStatus = :s, fileHash = :h",
            ExpressionAttributeValues={":s": status, ":h": file_hash},
        )
        print(f"SafeDrop: {key} -> {status}")
    return {"statusCode": 200}
