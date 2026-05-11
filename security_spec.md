# Security Specification

## Data Invariants
- Users can only read/write their own profiles.
- Users can only read/write their own chat messages.
- Users can only read/write their own knowledge base files.

## The "Dirty Dozen" Payloads (Examples)
1. Write to another user's chat path.
2. Write a message without a userId.
3. Update chat history with invalid role.
4. Upload file content larger than 1MB.
5. List all users from the users collection.
6. Delete another user's knowledge base.
7. Inject ghost fields into a chat message.
8. Create a knowledge item without content.
9. Attempt to read PII from another user.
10. Update a chat message role to "admin".
11. Create a chat message for a deleted user.
12. Write a message with an invalid timestamp.
