import { AttributeId } from "bdsx/bds/attribute";
import { GameRule, GameRuleId } from "bdsx/bds/gamerules";
import { TextPacket } from "bdsx/bds/packets";
import { serverInstance } from "bdsx/bds/server";
import { events } from "bdsx/event";
import { bedrockServer } from "bdsx/launcher";
import { loadedPlugins } from "bdsx/plugins";
import { execSync } from "child_process";
import { Utils } from "../utils";
import { selectedPlayers, serverData } from "./data";
import { panel, SocketEvents } from "./server";

panel.io.on("connection", (socket: any) => {
    socket.on(SocketEvents.Login, (username: string, password: string, silent?: boolean) => {
        if (username === panel.config.account.username && password === panel.config.account.password) {
            socket.emit(SocketEvents.Login);
            if (!silent) {
                socket.emit(SocketEvents.Toast, "Logged in successfully.", "success");
            }
            Utils.fetchAllPlugins().then(plugins => {
                if (plugins !== null) {
                    serverData.server.onlinePlugins = [];
                    for (const plugin of plugins) {
                        if (!loadedPlugins.includes(plugin.package.name)) {
                            serverData.server.onlinePlugins.push(plugin);
                        }
                    }
                }
            });
            socket.emit(SocketEvents.SyncServerData, {
                path: [],
                value: serverData,
            });
            socket.emit(SocketEvents.UpdateResourceUsage);

            socket.on(SocketEvents.StopServer, () => {
                socket.emit(SocketEvents.Toast, "Stopping server.");
               bedrockServer.stop();
            });
            socket.on(SocketEvents.RestartServer, () => {
                socket.emit(SocketEvents.Toast, "Restarting server.");
                events.serverStop.on(() => {
                    setTimeout(() => {
                        execSync(process.argv.join(" "), {stdio: "inherit"});
                    }, 5000);
                });
                bedrockServer.stop();
            });
            socket.on(SocketEvents.InputCommand, (command: string) => {
                socket.emit(SocketEvents.Toast, "Command sent.", "success");
                bedrockServer.executeCommandOnConsole(command);
            });
            socket.on(SocketEvents.InputChat, (chat: string) => {
                const pk = TextPacket.create();
                pk.type = TextPacket.Types.Chat;
                pk.name = panel.config["chat_name"];
                pk.message = chat;
                Utils.broadcastPacket(pk);
                socket.emit(SocketEvents.Toast, "Message sent.", "success");
                serverData.server.logs.chat.push({
                    name: panel.config["chat_name"],
                    message: Utils.formatColorCodesToHTML(chat),
                    time: new Date().getTime(),
                });
            });
            socket.on(SocketEvents.CheckForPluginUpdates, async (plugin: string, version: string) => {
                const update = await Utils.checkForPluginUpdates(plugin, version);
                switch (update) {
                case "not on npm":
                    socket.emit(SocketEvents.Toast, `${Utils.formatPluginName(plugin)} is not on npm.`, "danger");
                    break;
                case "up to date":
                    socket.emit(SocketEvents.Toast, `${Utils.formatPluginName(plugin)} is up to date.`, "success");
                    break;
                default:
                    socket.emit(SocketEvents.Toast, `${Utils.formatPluginName(plugin)} has an available update of ${update}.`, "success");
                }
            });
            socket.on(SocketEvents.InstallPlugin, (plugin: string, version?: string) => {
                socket.emit(SocketEvents.Toast, `Installing ${Utils.formatPluginName(plugin)}.`);
                execSync(`npm i ${plugin}${version ? "@" + version : ""}`, {stdio:'inherit'});
                socket.emit(SocketEvents.Toast, `Installed ${Utils.formatPluginName(plugin)}, it will be loaded on the next restart.`, "warning");
            });
            socket.on(SocketEvents.RemovePlugin, (plugin: string) => {
                socket.emit(SocketEvents.Toast, `Uninstalling ${Utils.formatPluginName(plugin)}.`);
                execSync(`npm r ${plugin}`, {stdio:'inherit'});
                socket.emit(SocketEvents.Toast, `Uninstalled ${Utils.formatPluginName(plugin)}, it will not be loaded on the next restart.`, "warning");
            });
            socket.on(SocketEvents.StartRequestPlayerInfo, (uuid: string) => {
                const ni = Utils.players.get(uuid);
                const player = ni?.getActor();
                if (player?.isPlayer()) {
                    selectedPlayers.push([uuid, ni!]);
                    serverData.server.game.players[uuid].gameInfo = {
                        ping: -1,
                        pos: player.getPosition().toJSON(),
                        rot: player.getRotation().toJSON(),
                        biome: "",
                        lvl: player.getAttribute(AttributeId.PlayerLevel),
                        health: {
                            current: player.getHealth(),
                            max: player.getMaxHealth(),
                        },
                        food: {
                            current: player.getAttribute(AttributeId.PlayerSaturation),
                            max: 20,
                        },
                        //inv: new InventoryRenderer(player.getInventory()),
                    };
                }
                socket.emit(SocketEvents.UpdateRequestedPlayerInventory);
            });
            socket.on(SocketEvents.StopRequestPlayerInfo, (uuid: string) => {
                selectedPlayers.splice(selectedPlayers.findIndex(e => e[0] === uuid), 1);
            });
            socket.on(SocketEvents.KickPlayer, (uuid: string, reason: string | null) => {
                const ni = Utils.players.get(uuid)!;
                if (ni) {
                    const name = ni.getActor()!.getName();
                    if (reason === null) {
                        serverInstance.disconnectClient(ni);
                    } else {
                        serverInstance.disconnectClient(ni, reason);
                    }
                    socket.emit(SocketEvents.Toast, `Kicked ${name}.`, "success");
                }
            });
            socket.on(SocketEvents.ChangeSetting, (category: string, name: string, value: any, type: GameRule.Type) => {
                switch (category) {
                case "Game Rules":
                    const gameRules = serverInstance.minecraft.getLevel().getGameRules();
                    const rule = gameRules.getRule(GameRuleId[name as unknown as number] as unknown as number);
                    rule.setValue(value, type);
                    serverInstance.minecraft.getLevel().syncGameRules();
                    break;
                case "World":
                    const level = serverInstance.minecraft.getLevel();
                    switch (name) {
                    // case "difficulty":
                    //     level.setDifficulty(value as number);
                    //     break;
                    case "allow-cheats":
                        serverData.server.game.options["World"]["allow-cheats"].value = value as boolean;
                        level.setCommandsEnabled(value as boolean);
                        break;
                    }
                    break;
                }

            });
        } else {
            socket.emit(SocketEvents.Toast, "Invalid username or password.", "danger");
        }
    });
});