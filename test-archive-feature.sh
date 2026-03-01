#!/bin/bash
# Test script for archive and title modification features

set -euo pipefail

API_URL="http://localhost:3847"

echo "═══════════════════════════════════════════════════════════"
echo "Testing Archive Feature Implementation"
echo "═══════════════════════════════════════════════════════════"

# Test 1: Create a conversation
echo -e "\n[Test 1] Creating a conversation..."
RESPONSE=$(curl -s -X POST "$API_URL/api/conversations" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Conversation","discussion_type":"general"}')
CONV_ID=$(echo "$RESPONSE" | grep -oP '"id":"[^"]+' | head -1 | cut -d'"' -f4)
echo "Created conversation: $CONV_ID"

if [ -z "$CONV_ID" ]; then
  echo "ERROR: Failed to create conversation"
  exit 1
fi

# Test 2: Verify conversation is active (not archived)
echo -e "\n[Test 2] Verifying conversation is not archived..."
RESPONSE=$(curl -s -X GET "$API_URL/api/conversations/$CONV_ID")
ARCHIVED_AT=$(echo "$RESPONSE" | grep -oP '"archived_at":\s*\K[^,}]+')
if [ "$ARCHIVED_AT" == "null" ]; then
  echo "✓ Conversation is not archived"
else
  echo "✗ ERROR: Conversation should not be archived"
fi

# Test 3: Modify conversation title
echo -e "\n[Test 3] Modifying conversation title..."
RESPONSE=$(curl -s -X PATCH "$API_URL/api/conversations/$CONV_ID" \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated Title"}')
NEW_TITLE=$(echo "$RESPONSE" | grep -oP '"title":"[^"]+' | head -1 | cut -d'"' -f4)
if [ "$NEW_TITLE" == "Updated Title" ]; then
  echo "✓ Title updated successfully: $NEW_TITLE"
else
  echo "✗ ERROR: Title not updated correctly"
  echo "Response: $RESPONSE"
fi

# Test 4: Archive the conversation
echo -e "\n[Test 4] Archiving the conversation..."
RESPONSE=$(curl -s -X POST "$API_URL/api/conversations/$CONV_ID/archive")
ARCHIVED_AT=$(echo "$RESPONSE" | grep -oP '"archived_at":"[^"]+' | head -1 | cut -d'"' -f4)
if [ -n "$ARCHIVED_AT" ] && [ "$ARCHIVED_AT" != "null" ]; then
  echo "✓ Conversation archived at: $ARCHIVED_AT"
else
  echo "✗ ERROR: Conversation should be archived"
  echo "Response: $RESPONSE"
fi

# Test 5: Verify archived conversation is excluded from GET /
echo -e "\n[Test 5] Verifying archived conversation is excluded from GET /..."
RESPONSE=$(curl -s -X GET "$API_URL/api/conversations")
if echo "$RESPONSE" | grep -q "$CONV_ID"; then
  echo "✗ ERROR: Archived conversation should not appear in default list"
else
  echo "✓ Archived conversation correctly excluded from default list"
fi

# Test 6: Verify archived conversation appears with ?include_archived=true
echo -e "\n[Test 6] Verifying archived conversation appears with ?include_archived=true..."
RESPONSE=$(curl -s -X GET "$API_URL/api/conversations?include_archived=true")
if echo "$RESPONSE" | grep -q "$CONV_ID"; then
  echo "✓ Archived conversation appears with ?include_archived=true"
else
  echo "✗ ERROR: Archived conversation should appear with ?include_archived=true"
fi

# Test 7: Add a message to archived conversation (should unarchive)
echo -e "\n[Test 7] Adding message to archived conversation (should auto-reactivate)..."
RESPONSE=$(curl -s -X POST "$API_URL/api/conversations/$CONV_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"content":"Test message","role":"human"}')
echo "Message added"

# Test 8: Verify conversation is unarchived
echo -e "\n[Test 8] Verifying conversation is unarchived..."
RESPONSE=$(curl -s -X GET "$API_URL/api/conversations/$CONV_ID")
ARCHIVED_AT=$(echo "$RESPONSE" | grep -oP '"archived_at":\s*\K[^,}]+')
if [ "$ARCHIVED_AT" == "null" ]; then
  echo "✓ Conversation is unarchived after new message"
else
  echo "✗ ERROR: Conversation should be unarchived"
  echo "Response: $RESPONSE"
fi

# Test 9: Verify conversation appears in default list again
echo -e "\n[Test 9] Verifying unarchived conversation appears in default GET /..."
RESPONSE=$(curl -s -X GET "$API_URL/api/conversations")
if echo "$RESPONSE" | grep -q "$CONV_ID"; then
  echo "✓ Unarchived conversation appears in default list"
else
  echo "✗ ERROR: Unarchived conversation should appear in default list"
fi

# Test 10: Unarchive endpoint
echo -e "\n[Test 10] Testing unarchive endpoint..."
curl -s -X POST "$API_URL/api/conversations/$CONV_ID/archive" > /dev/null
RESPONSE=$(curl -s -X POST "$API_URL/api/conversations/$CONV_ID/unarchive")
ARCHIVED_AT=$(echo "$RESPONSE" | grep -oP '"archived_at":\s*\K[^,}]+')
if [ "$ARCHIVED_AT" == "null" ]; then
  echo "✓ Unarchive endpoint works"
else
  echo "✗ ERROR: Unarchive failed"
fi

echo -e "\n═══════════════════════════════════════════════════════════"
echo "All tests completed!"
echo "═══════════════════════════════════════════════════════════"
