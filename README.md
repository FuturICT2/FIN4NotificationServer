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

### MongoDB

Install MongoDB on Ubuntu (via [here](https://www.digitalocean.com/community/tutorials/how-to-install-mongodb-on-ubuntu-18-04#step-1-%E2%80%94-installing-mongodb)):

```sh
sudo apt update
sudo apt install -y mongodb
```

If that doesn't work, try [these](https://docs.mongodb.com/manual/tutorial/install-mongodb-on-ubuntu/) instructions.

Check the MongoDB status using `sudo systemctl status mongodb`. Find the location of the database folder using `grep -i dbPath /etc/mongod.conf`.

To see what's in the database, run `mongo` and then `show dbs` to see all databases. Switch to our database using `use notification_server` and then use `show collections` to see available collections. `db.email_subscribers.find()` and `db.telegram_subscribers.find()` reveales the respective entries. Use `db.collection-name.drop()` to delete a collection. With `exit` you can get out again.
