"""
AWS Lambda — API handlers behind API Gateway (proxy integration).

These mirror the preview FastAPI routes in /app/backend/server.py. Each function is
a thin, single-responsibility handler suited to a dedicated Lambda + API Gateway route.
All objects live in a PRIVATE S3 bucket; downloads are served ONLY via short-lived
pre-signed GET URLs generated after an authorization check. AWS credentials are never
returned to the client.

Env vars: BUCKET, METADATA_TABLE, PRESIGN_TTL (seconds)
IAM: see /app/aws/iam/lambda-policy.json (least privilege)
"""
import os
import json
import time
import secrets
import boto3
from boto3.dynamodb.conditions import Attr

s3 = boto3.client("s3")
ddb = boto3.resource("dynamodb")
TABLE = ddb.Table(os.environ["METADATA_TABLE"])
BUCKET = os.environ["BUCKET"]
PRESIGN_TTL = int(os.environ.get("PRESIGN_TTL", 120))

LIFETIME_MAP = {"5m": 300, "15m": 900, "1h": 3600, "24h": 86400}


def _resp(code, body):
    return {"statusCode": code, "headers": {"Content-Type": "application/json",
                                            "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(body)}


def _status(item):
    if item.get("status") == "USED":
        return "USED"
    now = int(time.time())
    if now >= int(item["expiryTime"]):
        return "EXPIRED"
    remaining = int(item["expiryTime"]) - now
    total = int(item["expiryTime"]) - int(item["uploadTime"])
    if remaining <= max(60, total * 0.15):
        return "EXPIRING SOON"
    return "ACTIVE"


# POST /api/upload  — presigned PUT flow: client PUTs directly to S3 using this URL,
# S3 ObjectCreated event then triggers safedrop_validator.
def create_share(event, context):
    body = json.loads(event["body"])
    share_id = "DBX-" + secrets.token_hex(4).upper()
    ext = body["filename"].rsplit(".", 1)[-1].lower()
    object_key = f"dropboxer/uploads/{body['sessionId']}/{secrets.token_hex(16)}.{ext}"
    now = int(time.time())
    item = {
        "shareId": share_id, "objectKey": object_key,
        "originalFileName": body["filename"], "contentType": body.get("contentType", "application/octet-stream"),
        "uploadTime": now, "expiryTime": now + LIFETIME_MAP[body["lifetime"]],
        "downloadCount": 0, "maxDownloads": 1 if body.get("oneTime") else 1_000_000,
        "oneTime": bool(body.get("oneTime")), "status": "ACTIVE", "safetyStatus": "scanning",
        "fileHash": "", "sessionId": body["sessionId"],
    }
    TABLE.put_item(Item=item)
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": object_key, "ContentType": item["contentType"],
                "Metadata": {"original-filename": body["filename"]}},
        ExpiresIn=PRESIGN_TTL,
    )
    return _resp(200, {"shareId": share_id, "uploadUrl": upload_url, **item})


# GET /api/share/{shareId}
def get_share(event, context):
    share_id = event["pathParameters"]["shareId"]
    res = TABLE.query(IndexName="shareId-index",
                      KeyConditionExpression="shareId = :s",
                      ExpressionAttributeValues={":s": share_id})
    items = res.get("Items", [])
    if not items:
        return _resp(404, {"error": "invalid", "message": "Invalid or unavailable share."})
    item = items[0]
    return _resp(200, {"shareId": share_id, "status": _status(item), **{k: item[k] for k in
                 ("originalFileName", "fileSize", "contentType", "expiryTime", "downloadCount",
                  "maxDownloads", "oneTime", "safetyStatus", "fileHash") if k in item}})


# GET /api/download/{shareId}  — authorization gate -> presigned GET URL
def download(event, context):
    share_id = event["pathParameters"]["shareId"]
    res = TABLE.query(IndexName="shareId-index",
                      KeyConditionExpression="shareId = :s",
                      ExpressionAttributeValues={":s": share_id})
    items = res.get("Items", [])
    if not items:
        return _resp(404, {"error": "invalid"})
    item = items[0]
    if item["safetyStatus"] != "verified":
        return _resp(403, {"error": "unsafe"})
    st = _status(item)
    if st == "EXPIRED":
        return _resp(410, {"error": "expired", "message": "This file has expired and is no longer available."})
    if st == "USED" or item["downloadCount"] >= item["maxDownloads"]:
        return _resp(410, {"error": "used", "message": "This one-time link has already been used."})
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": item["objectKey"],
                "ResponseContentDisposition": f'attachment; filename="{item["originalFileName"]}"'},
        ExpiresIn=PRESIGN_TTL,
    )
    return _resp(200, {"downloadUrl": url})


# POST /api/consume/{shareId}  — atomic Burn After Download record
def consume(event, context):
    share_id = event["pathParameters"]["shareId"]
    res = TABLE.query(IndexName="shareId-index",
                      KeyConditionExpression="shareId = :s",
                      ExpressionAttributeValues={":s": share_id})
    items = res.get("Items", [])
    if not items:
        return _resp(404, {"error": "invalid"})
    item = items[0]
    try:
        # Conditional update prevents a second successful download (race-safe)
        TABLE.update_item(
            Key={"objectKey": item["objectKey"]},
            UpdateExpression="SET downloadCount = downloadCount + :one",
            ConditionExpression=Attr("downloadCount").lt(item["maxDownloads"]) & Attr("status").ne("USED"),
            ExpressionAttributeValues={":one": 1},
        )
    except s3.exceptions.ClientError:
        return _resp(410, {"error": "used", "message": "This one-time link has already been used."})
    if item["oneTime"]:
        TABLE.update_item(Key={"objectKey": item["objectKey"]},
                          UpdateExpression="SET #s = :u",
                          ExpressionAttributeNames={"#s": "status"},
                          ExpressionAttributeValues={":u": "USED"})
    return _resp(200, {"shareId": share_id, "status": "USED" if item["oneTime"] else "ACTIVE"})
