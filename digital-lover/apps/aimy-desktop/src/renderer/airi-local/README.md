# AIRI local conversation reuse

The database repository and chat types are copied from `airi-main/packages/stage-ui/src`, under the AIRI MIT license. They are kept intact so their source remains comparable. `database/storage.ts` changes only the database base to `aimy-local` and removes the unused cloud outbox mount.

The Aimy composition calls only index/session read, write and local deletion. It has no cloud service, account, WebSocket, outbox drain or authentication consumer.
