# FIN4NotificationServer
Forwarding FIN4 contract events to connected clients, email subscribers and a telegram bot

### Config file

The file `config.json` at root level must be added and filled.

```json
{
    "INFURA_API_KEY": "",
    "CONTRACTS_BUILD_DIRECTORY": "../FIN4Xplorer/src/build/contracts",
    "FIN4MAIN_ADDRESS": "",
    "TELEGRAM_BOT_TOKEN": "",
    "AWS_SES": {
        "KEY": "",
        "SECRET": "",
        "REGION": "https://email.eu-central-1.amazonaws.com"
    },
    "THIS_URL": "https://notifications.finfour.net",
    "FIN4_URL": "https://demo.finfour.net"
}
```
