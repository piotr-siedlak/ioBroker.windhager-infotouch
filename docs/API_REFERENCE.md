# Controller API reference (from the controller itself)

Source: the Swagger 1.2 documents the InfoWIN Touch serves under `/api-docs/<service>/1.0/<resource>`, read on
2026-10-22 from an MB6621 with firmware 0.10.4 (read-only GET of the documentation files only). Base path of the
REST services is `/api/1.0`; all calls use HTTP Digest authentication.

**Class** says how this adapter treats each operation:

- **used (read)**: called by the adapter (GET only).
- **used (write, opt-in only)**: only after writes are enabled and the exact OID is allow-listed; verified by read-back.
- _not used (read)_: harmless reads the adapter does not need today.
- _never_: mutating operations, or reads with side effects / security relevance (users, VPN, settings, LON management,
  scans, hardware tests, firmware). The adapter has no code path to them.

In addition to these REST services the adapter reads the static text files `/res/xml/{EbenenTexte,VarIdentTexte,AufzaehlTexte}_<lang>.xml`
(GET only; not part of the Swagger documents).

Observed on this firmware: `/fehlerlog` and `/heartbeat` answer 503; `/lookup/units/{cat}` answers 404 for categories 0-3;
the lookup tree returns complete groups without paging; `/datapoints` returns the controller cache (a superset of the
menu tree). OIDs are `/<subnet>/<node>/<function>/<group>/<member>/<instance>`.

| Service          | Method | Path                                                                    | Summary                                              | Class                          |
| ---------------- | ------ | ----------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------ |
| DcmRC7030        | GET    | `/info/{id}`                                                            | Retrieve id info                                     | not used (read)                |
| DcmRC7030        | PUT    | `/msg1025/push`                                                         | push msg1025                                         | never (mutating)               |
| DcmRC7030        | GET    | `/settings`                                                             | get settings list                                    | never (sensitive/side effects) |
| DcmRC7030        | GET    | `/settings/allKeys`                                                     | get list af all keys                                 | never (sensitive/side effects) |
| DcmRC7030        | GET    | `/settings/{key}`                                                       | get settings value from key                          | never (sensitive/side effects) |
| DcmRC7030        | PUT    | `/settings/{key}`                                                       | update value value for key                           | never (mutating)               |
| DcmRC7030        | PUT    | `/settings/logging/level`                                               | update logging level                                 | never (mutating)               |
| DcmRC7030        | POST   | `/settings/reset/all`                                                   | reset all settings                                   | never (mutating)               |
| InfoWinFehlerlog | GET    | `/fehlerlog`                                                            | Retrieve fehlerlog list                              | not used (read)                |
| InfoWinFehlerlog | POST   | `/fehlerlog`                                                            | Add new fehlerlog item                               | never (mutating)               |
| InfoWinFehlerlog | GET    | `/fehlerlog/rawlist`                                                    | Retrieve fehlerlog raw list                          | not used (read)                |
| InfoWinFehlerlog | GET    | `/fehlerlog/{id}`                                                       | Retrieve fehlerlog at 'id'                           | not used (read)                |
| InfoWinFehlerlog | PUT    | `/fehlerlog/{id}`                                                       | Update fehlerlog.status at 'id'                      | never (mutating)               |
| InfoWinFehlerlog | DELETE | `/fehlerlog/{id}`                                                       | Delete fehlerlog at 'id'                             | never (mutating)               |
| InfoWinFehlerlog | PUT    | `/fehlerlog/reset/{id}`                                                 | Reset id (Quittierung)                               | never (mutating)               |
| InfoWinFehlerlog | POST   | `/fehlerlog/{subnetId}/{nodeId}`                                        | Add 'eBUS FE01' message                              | never (mutating)               |
| InfoWinFehlerlog | GET    | `/info/{id}`                                                            | Retrieve id info                                     | not used (read)                |
| InfoWinFehlerlog | GET    | `/settings`                                                             | get settings list                                    | never (sensitive/side effects) |
| InfoWinFehlerlog | GET    | `/settings/allKeys`                                                     | get list af all keys                                 | never (sensitive/side effects) |
| InfoWinFehlerlog | GET    | `/settings/{key}`                                                       | get settings value from key                          | never (sensitive/side effects) |
| InfoWinFehlerlog | PUT    | `/settings/{key}`                                                       | update value value for key                           | never (mutating)               |
| InfoWinFehlerlog | PUT    | `/settings/logging/level`                                               | update logging level                                 | never (mutating)               |
| InfoWinHeartbeat | GET    | `/heartbeat`                                                            | Retrieve current heartbeat                           | not used (read)                |
| InfoWinHeartbeat | POST   | `/heartbeat`                                                            | Create new heartbeat                                 | never (mutating)               |
| InfoWinHeartbeat | DELETE | `/heartbeat`                                                            | Delete (stop) current heartbeat                      | never (mutating)               |
| InfoWinHeartbeat | PUT    | `/heartbeat/{subnet}/{nodeId}`                                          | update heartbeat (Indication from subnet/nodeId)     | never (mutating)               |
| InfoWinHeartbeat | GET    | `/info/{id}`                                                            | Retrieve id info                                     | not used (read)                |
| InfoWinHeartbeat | GET    | `/kesselwahl/{method}`                                                  | Retrieve kesselwahl                                  | never (sensitive/side effects) |
| InfoWinHeartbeat | PUT    | `/kesselwahl/{id}`                                                      | start kesselwahl                                     | never (mutating)               |
| InfoWinHeartbeat | PUT    | `/kesselwahl/servicepin`                                                | new servicepin message                               | never (mutating)               |
| InfoWinHeartbeat | GET    | `/kesselwahl/servicepin/listener`                                       | get servicepin listener state                        | never (sensitive/side effects) |
| InfoWinHeartbeat | POST   | `/kesselwahl/servicepin/listener/{method}`                              | post service listener method                         | never (mutating)               |
| InfoWinHeartbeat | GET    | `/settings`                                                             | get settings list                                    | never (sensitive/side effects) |
| InfoWinHeartbeat | GET    | `/settings/allKeys`                                                     | get list af all keys                                 | never (sensitive/side effects) |
| InfoWinHeartbeat | GET    | `/settings/{key}`                                                       | get settings value from key                          | never (sensitive/side effects) |
| InfoWinHeartbeat | PUT    | `/settings/{key}`                                                       | update value value for key                           | never (mutating)               |
| InfoWinHeartbeat | PUT    | `/settings/logging/level`                                               | update logging level                                 | never (mutating)               |
| RestApiRC7030    | GET    | `/config/network`                                                       | Network configuration                                | never (sensitive/side effects) |
| RestApiRC7030    | PUT    | `/config/network`                                                       | Update Network configuration                         | never (mutating)               |
| RestApiRC7030    | GET    | `/config/DynIP`                                                         | DynIp configuration                                  | never (sensitive/side effects) |
| RestApiRC7030    | PUT    | `/config/DynIP`                                                         | Update DynIP configuration                           | never (mutating)               |
| RestApiRC7030    | GET    | `/config/Alarm`                                                         | Alarm configuration                                  | never (sensitive/side effects) |
| RestApiRC7030    | PUT    | `/config/Alarm`                                                         | Update Alarm configuration                           | never (mutating)               |
| RestApiRC7030    | PUT    | `/datapoint`                                                            | Update Datapoint                                     | **used (write, opt-in only)**  |
| RestApiRC7030    | GET    | `/datapoint/{subnetId}/{nodeId}/{fctId}/{groupId}/{memberId}/{varInst}` | Retrieve Datapoint                                   | **used (read)**                |
| RestApiRC7030    | PUT    | `/datapoint/{subnetId}/{nodeId}/{fctId}/{groupId}/{memberId}/{varInst}` | Update Datapoint                                     | never (mutating)               |
| RestApiRC7030    | GET    | `/datapoint/{subnetId}/{nodeId}/{fctNV}/0/{nvIndex}/0`                  | Retrieve NV Datapoint                                | not used (read)                |
| RestApiRC7030    | GET    | `/datapoints`                                                           | Retrieve a OID Datapoint                             | **used (read)**                |
| RestApiRC7030    | PUT    | `/datapoints`                                                           | Update Network configuration                         | never (mutating)               |
| RestApiRC7030    | GET    | `/DynIP/CheckIP`                                                        | CheckIP                                              | not used (read)                |
| RestApiRC7030    | PUT    | `/DynIP/UpdateIP`                                                       | UpdateIP                                             | never (mutating)               |
| RestApiRC7030    | POST   | `/DynIP/OnAlarm`                                                        | OnAlarm                                              | never (mutating)               |
| RestApiRC7030    | GET    | `/info/{id}`                                                            | Retrieve id info                                     | **used (read)**                |
| RestApiRC7030    | GET    | `/lookup`                                                               | Subnet Collection                                    | **used (read)**                |
| RestApiRC7030    | GET    | `/lookup/{subnetId}`                                                    | Node Collection                                      | **used (read)**                |
| RestApiRC7030    | GET    | `/lookup/{subnetId}/{nodeId}`                                           | Retrieve a Node                                      | **used (read)**                |
| RestApiRC7030    | GET    | `/lookup/{subnetId}/{nodeId}/{fctId}`                                   | Level Collection                                     | **used (read)**                |
| RestApiRC7030    | GET    | `/lookup/{subnetId}/{nodeId}/{fctId}/{levelId}`                         | Datapoint Collection                                 | **used (read)**                |
| RestApiRC7030    | GET    | `/lookup/{subnetId}/{nodeId}/{fctId}/{levelId}/{position}`              | Retrieve Datapoint                                   | not used (read)                |
| RestApiRC7030    | PUT    | `/lookup/{subnetId}/{nodeId}/{fctId}/{levelId}/{position}`              | Update Datapoint                                     | never (mutating)               |
| RestApiRC7030    | GET    | `/lookup/{subnetId}/{nodeId}/{fctNV}`                                   | NV Collection count                                  | not used (read)                |
| RestApiRC7030    | GET    | `/lookup/{subnetId}/{nodeId}/{fctNV}/0`                                 | NV Collection                                        | not used (read)                |
| RestApiRC7030    | GET    | `/lookup/{subnetId}/{nodeId}/{fctNV}/0/{nvIndex}`                       | Retrieve NV Datapoint                                | **used (read)**                |
| RestApiRC7030    | GET    | `/lookup/units/{cat}`                                                   | Unit Collection                                      | not used (read)                |
| RestApiRC7030    | GET    | `/nodes`                                                                | Nodes Collection                                     | not used (read)                |
| RestApiRC7030    | GET    | `/object`                                                               | Retrieve OID Object                                  | **used (read)**                |
| RestApiRC7030    | PUT    | `/object`                                                               | Update OID object                                    | never (mutating)               |
| RestApiRC7030    | GET    | `/scan/nodes/model`                                                     | scan model                                           | never (sensitive/side effects) |
| RestApiRC7030    | PUT    | `/scan/nodes/model`                                                     | scan model                                           | never (mutating)               |
| RestApiRC7030    | GET    | `/scan/nodes/status`                                                    | scan status                                          | never (sensitive/side effects) |
| RestApiRC7030    | PUT    | `/scan/nodes/{cmd}`                                                     | LonScanStateMachine commands.                        | never (mutating)               |
| RestApiRC7030    | GET    | `/scan/nvcount/{subnetId}/{nodeId}`                                     | get nvcount from a Node                              | never (sensitive/side effects) |
| RestApiRC7030    | GET    | `/scan/nvstruct/{subnetId}/{nodeId}`                                    | get nvstruct from a Node                             | never (sensitive/side effects) |
| RestApiRC7030    | GET    | `/scan/nv/{subnetId}/{nodeId}`                                          | scan NVs from a Node                                 | never (sensitive/side effects) |
| RestApiRC7030    | GET    | `/settings`                                                             | get settings list                                    | never (sensitive/side effects) |
| RestApiRC7030    | GET    | `/settings/allKeys`                                                     | get list af all keys                                 | never (sensitive/side effects) |
| RestApiRC7030    | GET    | `/settings/{key}`                                                       | get settings value from key                          | never (sensitive/side effects) |
| RestApiRC7030    | PUT    | `/settings/{key}`                                                       | update value value for key                           | never (mutating)               |
| RestApiRC7030    | PUT    | `/settings/logging/level`                                               | update logging level                                 | never (mutating)               |
| RestApiRC7030    | GET    | `/user/users`                                                           | Retrieve all users                                   | never (sensitive/side effects) |
| RestApiRC7030    | GET    | `/user/groups`                                                          | Retrieve all groups                                  | never (sensitive/side effects) |
| RestApiRC7030    | GET    | `/user/group/{groupname}`                                               | Retrieve group                                       | never (sensitive/side effects) |
| RestApiRC7030    | POST   | `/user/group/{groupname}`                                               | Add user to group                                    | never (mutating)               |
| RestApiRC7030    | DELETE | `/user/group/{groupname}`                                               | Delete user from group                               | never (mutating)               |
| RestApiRC7030    | POST   | `/user`                                                                 | Create user                                          | never (mutating)               |
| RestApiRC7030    | PUT    | `/user`                                                                 | Updated user                                         | never (mutating)               |
| RestApiRC7030    | DELETE | `/user/{username}`                                                      | Delete user                                          | never (mutating)               |
| RestApiRC7030    | GET    | `/user/{username}`                                                      | Get user by user name                                | never (sensitive/side effects) |
| RestApiRC7030    | GET    | `/user/login`                                                           | Logs user into the system                            | never (sensitive/side effects) |
| RestApiRC7030    | GET    | `/user/logout`                                                          | Logs out current logged in user session              | never (sensitive/side effects) |
| RestApiRC7030    | DELETE | `/key`                                                                  | Löscht den aktuellen Key                             | never (mutating)               |
| RestApiRC7030    | POST   | `/key`                                                                  | Generiert einen neuen Key                            | never (mutating)               |
| RestApiRC7030    | GET    | `/csr`                                                                  | Gibt das aktuelle erstelle CSR zurück                | not used (read)                |
| RestApiRC7030    | POST   | `/csr`                                                                  | Erzeugt einen neuen CSR                              | never (mutating)               |
| RestApiRC7030    | PUT    | `/csr`                                                                  | Sendet das CSR zur VPN API                           | never (mutating)               |
| RestApiRC7030    | GET    | `/crt`                                                                  | Ladet das erstellte CRT herunter und speichert es ab | not used (read)                |
| RestApiRC7030    | DELETE | `/crt`                                                                  | Löscht das aktuelle Zertifikat                       | never (mutating)               |
| RestApiRC7030    | GET    | `/status`                                                               | Gibt den aktuellen status der VPN API zurück         | not used (read)                |
| RestApiRC7030    | POST   | `/mac`                                                                  | Überschreibt die aktuelle MAC Adresse (temporär)     | never (mutating)               |
| WsAdmin          | GET    | `/info/{id}`                                                            | Retrieve id info                                     | not used (read)                |
| WsAdmin          | GET    | `/led`                                                                  | LED Collection                                       | not used (read)                |
| WsAdmin          | GET    | `/led/{id}`                                                             | Retrieve LED status                                  | not used (read)                |
| WsAdmin          | PUT    | `/led/{id}`                                                             | Update LED                                           | never (mutating)               |
| WsAdmin          | GET    | `/led/scene`                                                            | old interface                                        | not used (read)                |
| WsAdmin          | PUT    | `/led/scene/{id}`                                                       | update LED scene                                     | never (mutating)               |
| WsAdmin          | GET    | `/settings`                                                             | get settings list                                    | never (sensitive/side effects) |
| WsAdmin          | GET    | `/settings/allKeys`                                                     | get list af all keys                                 | never (sensitive/side effects) |
| WsAdmin          | GET    | `/settings/{key}`                                                       | get settings value from key                          | never (sensitive/side effects) |
| WsAdmin          | PUT    | `/settings/{key}`                                                       | update value value for key                           | never (mutating)               |
| WsAdmin          | PUT    | `/settings/logging/level`                                               | update logging level                                 | never (mutating)               |
| WsAdmin          | GET    | `/systemtime`                                                           | get current systemtime [ISO 8601]                    | not used (read)                |
| WsAdmin          | PUT    | `/systemtime`                                                           | update systemtime                                    | never (mutating)               |
| WsAdmin          | GET    | `/systemtime/ntpserver`                                                 | Retrieve ntp server list                             | not used (read)                |
| WsAdmin          | POST   | `/systemtime/ntpserver`                                                 | Add new ntp server item                              | never (mutating)               |
| WsAdmin          | GET    | `/systemtime/ntpserver/selected`                                        | get selected ntp server                              | not used (read)                |
| WsAdmin          | GET    | `/systemtime/ntpserver/{id}`                                            | Retrieve ntp server at 'id'                          | not used (read)                |
| WsAdmin          | DELETE | `/systemtime/ntpserver/{id}`                                            | Delete ntp server at 'id'                            | never (mutating)               |
| WsAdmin          | PUT    | `/systemtime/ntpserver/select/{id}`                                     | Update ntpserver.selected at 'id'                    | never (mutating)               |
| WsAdmin          | GET    | `/systemtime/timezone`                                                  | get current timezone information and timezone list   | not used (read)                |
| WsAdmin          | PUT    | `/systemtime/timezone`                                                  | update timezone                                      | never (mutating)               |
| WsAdmin          | GET    | `/update/factoryReset`                                                  | Retrieve FactoryReset Status                         | not used (read)                |
| WsAdmin          | PUT    | `/update/factoryReset/{method}`                                         | Factory Reset methods                                | never (mutating)               |
| WsAdmin          | GET    | `/update/firmware/{method}`                                             | Retrieve firmware info                               | not used (read)                |
| WsAdmin          | PUT    | `/update/firmware/{method}`                                             | update firmware operations                           | never (mutating)               |
| WsAdmin          | POST   | `/update/firmware/{method}`                                             | Retrieve firmware                                    | never (mutating)               |
| WsAdmin          | GET    | `/user/login`                                                           | Logs user into the system                            | never (sensitive/side effects) |
| WsAdmin          | GET    | `/user/logout`                                                          | Logs out current logged in user session              | never (sensitive/side effects) |
| WsFUP7030        | GET    | `/LON/nodeAddress/{domainIdx}`                                          | get nodeAdress                                       | never (sensitive/side effects) |
| WsFUP7030        | PUT    | `/LON/nviTimeSet/{year}/{month}/{day}/{hour}/{min}/{sec}`               | update nviTimeSet                                    | never (mutating)               |
| WsFUP7030        | PUT    | `/LON/msg`                                                              | Send msg Services (ACKD or UNACK)                    | never (mutating)               |
| WsFUP7030        | POST   | `/LON/msg`                                                              | Request/Response msg Services                        | never (mutating)               |
| WsFUP7030        | PUT    | `/LON/NMPDU`                                                            | Network Management Services (ACKD or UNACK)          | never (mutating)               |
| WsFUP7030        | POST   | `/LON/NMPDU`                                                            | Network Management Services                          | never (mutating)               |
| WsFUP7030        | POST   | `/LON/NMPDU/QueryID/{group}/{selector}`                                 | Network Management Query ID                          | never (mutating)               |
| WsFUP7030        | PUT    | `/LON/NMPDU/RespondToQuery/group/{groupId}/{mode}`                      | Network Management Respond to Query (UNACKD)         | never (mutating)               |
| WsFUP7030        | POST   | `/LON/NMPDU/RespondToQuery/group/{groupId}/{mode}`                      | Network Management Respond to Query                  | never (mutating)               |
| WsFUP7030        | POST   | `/LON/NMPDU/RespondToQuery/snode/{subnet}/{nodeId}/{mode}`              | Network Management Respond to Query                  | never (mutating)               |
| WsFUP7030        | PUT    | `/LON/NMPDU/RespondToQuery/neuronId`                                    | Network Management Respond to Query (UNACKD)         | never (mutating)               |
| WsFUP7030        | POST   | `/LON/NMPDU/RespondToQuery/neuronId`                                    | Network Management Respond to Query                  | never (mutating)               |
| WsFUP7030        | GET    | `/LON/NMPDU/QueryAddress/{subnet}/{nodeId}/{index}`                     | NMPDU Query Address                                  | never (sensitive/side effects) |
| WsFUP7030        | GET    | `/LON/NMPDU/QueryNvConfiguration/{subnet}/{nodeId}/{nvIndex}`           | NMPDU Query Network Variable Configuration           | never (sensitive/side effects) |
| WsFUP7030        | POST   | `/LON/NMPDU/QueryDomain`                                                | Network Management Query Domain                      | never (mutating)               |
| WsFUP7030        | GET    | `/LON/NMPDU/QueryDomain`                                                | Network Management Query Domain                      | never (sensitive/side effects) |
| WsFUP7030        | GET    | `/LON/NMPDU/NvValueFetch/{subnet}/{nodeId}/{nvIndex}`                   | Network Management Network Variable Value Fetch      | never (sensitive/side effects) |
| WsFUP7030        | GET    | `/config/nodeAddress/{domainIdx}`                                       | get nodeAdress                                       | never (sensitive/side effects) |
| WsFUP7030        | PUT    | `/config/nodeAddress`                                                   | update nodeAdress                                    | never (mutating)               |
| WsFUP7030        | GET    | `/config/lon/bitrate`                                                   | get LON Transceiver Bit Rate                         | never (sensitive/side effects) |
| WsFUP7030        | PUT    | `/config/lon/bitrate`                                                   | update LON Transceiver Bit Rate                      | never (mutating)               |
| WsFUP7030        | GET    | `/config/lon/transceiver`                                               | get LON Tranceiver config data                       | never (sensitive/side effects) |
| WsFUP7030        | PUT    | `/config/lon/transceiver`                                               | update LON Tranceiver config data                    | never (mutating)               |
| WsFUP7030        | PUT    | `/config/lon/swreset`                                                   | Software Reset on LON Chip                           | never (mutating)               |
| WsFUP7030        | GET    | `/hwtest/fup`                                                           | Retrieve id info                                     | never (sensitive/side effects) |
| WsFUP7030        | GET    | `/hwtest/lop/{id}`                                                      | Retrieve LOP App info                                | never (sensitive/side effects) |
| WsFUP7030        | PUT    | `/hwtest/lop/brdcstLock`                                                | Set Broadcast Lock                                   | never (mutating)               |
| WsFUP7030        | GET    | `/info/{id}`                                                            | Retrieve id info                                     | not used (read)                |
| WsFUP7030        | PUT    | `/led`                                                                  | update LED object                                    | never (mutating)               |
| WsFUP7030        | GET    | `/led/{id}`                                                             | Retrieve LED status                                  | not used (read)                |
| WsFUP7030        | PUT    | `/led/{id}`                                                             | Update LED                                           | never (mutating)               |
| WsFUP7030        | GET    | `/led/scene`                                                            | retrieve LED scene                                   | not used (read)                |
| WsFUP7030        | PUT    | `/led/scene/{id}`                                                       | update LED scene                                     | never (mutating)               |
| WsFUP7030        | POST   | `/lonscan/test/{step}`                                                  | Retrieve test                                        | never (mutating)               |
| WsFUP7030        | POST   | `/lonscan/run`                                                          | run lonscan                                          | never (mutating)               |
| WsFUP7030        | POST   | `/notification/register`                                                | register for a new notification                      | never (mutating)               |
| WsFUP7030        | POST   | `/notification/unregister`                                              | unregister the notification                          | never (mutating)               |
| WsFUP7030        | GET    | `/settings`                                                             | get settings list                                    | never (sensitive/side effects) |
| WsFUP7030        | GET    | `/settings/allKeys`                                                     | get list af all keys                                 | never (sensitive/side effects) |
| WsFUP7030        | GET    | `/settings/{key}`                                                       | get settings value from key                          | never (sensitive/side effects) |
| WsFUP7030        | PUT    | `/settings/{key}`                                                       | update value value for key                           | never (mutating)               |
| WsFUP7030        | PUT    | `/settings/logging/level`                                               | update logging level                                 | never (mutating)               |
| WsFUP7030        | GET    | `/srv0620`                                                              | Retrieve srv0620                                     | never (sensitive/side effects) |
| WsFUP7030        | POST   | `/srv0620`                                                              | Retrieve srv0620                                     | never (mutating)               |
| WsFUP7030        | GET    | `/srv0620/{subnet}/{nodeId}/{fnctNbr}/{levelIdx}`                       | Retrieve srv0620                                     | never (sensitive/side effects) |
| WsFUP7030        | POST   | `/srv0621`                                                              | Retrieve srv0621                                     | never (mutating)               |
| WsFUP7030        | GET    | `/srv0621/{subnet}/{nodeId}/{mainSel}/{subSel}`                         | Retrieve srv0621                                     | never (sensitive/side effects) |
| WsFUP7030        | POST   | `/srv0622`                                                              | Retrieve srv0622                                     | never (mutating)               |
| WsFUP7030        | GET    | `/srv0622/{subnet}/{nodeId}/{mainSel}/{subSel}`                         | Retrieve srv0622                                     | never (sensitive/side effects) |
| WsFUP7030        | PUT    | `/srv0623`                                                              | Write srv0623 with OID                               | never (mutating)               |
| WsFUP7030        | POST   | `/srv0623`                                                              | Write srv0623 with body                              | never (mutating)               |
| WsFUP7030        | GET    | `/srv1024/{subnetId}/{nodeId}/{fctId}/{groupId}/{memberId}/{varInst}`   | Retrieve Datapoint                                   | never (sensitive/side effects) |
| WsFUP7030        | PUT    | `/srv1025`                                                              | Put srv0623 with OID                                 | never (mutating)               |
| WsFUP7030        | PUT    | `/windyndata/{subnetId}/{nodeId}/1/{DapId}/{value}`                     | windyndata WriteDap                                  | never (mutating)               |
| WsFUP7030        | GET    | `/windyndata/{subnetId}/{nodeId}/2/{DapId}`                             | windyndata ReadDap                                   | never (sensitive/side effects) |
| WsFUP7030        | GET    | `/windyndata/{subnetId}/{nodeId}/3/{FctSel}`                            | Read windyndata FctCall                              | never (sensitive/side effects) |
| WsFUP7030        | PUT    | `/windyndata/{subnetId}/{nodeId}/3/{FctSel}/{Param}`                    | Write windyndata FctCall                             | never (mutating)               |
| WsFUP7030        | PUT    | `/windyndata/{subnetId}/{nodeId}/3/{FctSel}/{k}/{value}`                | Write windyndata FctCall                             | never (mutating)               |
| WsFUP7030        | PUT    | `/windyndata`                                                           | Write windyndata with body                           | never (mutating)               |
| WsFUP7030        | GET    | `/winservice/{subnetId}/{nodeId}/{code}/{subcode}`                      | Retrieve winservice                                  | never (sensitive/side effects) |
| WsFUP7030        | PUT    | `/winservice`                                                           | update winservice object                             | never (mutating)               |
| dprecorder       | GET    | `/info/{id}`                                                            | Retrieve id info                                     | not used (read)                |
| dprecorder       | GET    | `/recorder/{id}`                                                        | Retrieve id recorder                                 | not used (read)                |
| dprecorder       | PUT    | `/recorder/{id}`                                                        | Retrieve id recorder                                 | never (mutating)               |
| dprecorder       | POST   | `/recorder/{action}`                                                    | Manualy trigger executing the actionSet              | never (mutating)               |
| dprecorder       | POST   | `/recorder/datapoint`                                                   | Add new OID Datapoint                                | never (mutating)               |
| dprecorder       | DELETE | `/recorder/datapoint`                                                   | Delete OID Datapoint                                 | never (mutating)               |
| dprecorder       | DELETE | `/recorder/oids`                                                        | Delete Recorder OID List                             | never (mutating)               |
| dprecorder       | GET    | `/settings`                                                             | get settings list                                    | never (sensitive/side effects) |
| dprecorder       | GET    | `/settings/allKeys`                                                     | get list af all keys                                 | never (sensitive/side effects) |
| dprecorder       | GET    | `/settings/{key}`                                                       | get settings value from key                          | never (sensitive/side effects) |
| dprecorder       | PUT    | `/settings/{key}`                                                       | update value value for key                           | never (mutating)               |
| dprecorder       | PUT    | `/settings/logging/level`                                               | update logging level                                 | never (mutating)               |
| dprecorder       | POST   | `/settings/reset/all`                                                   | reset all settings                                   | never (mutating)               |

201 operations in 7 services.
