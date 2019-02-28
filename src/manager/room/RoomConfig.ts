import { Config } from "manager/Config";
import { Manager } from "manager/Manager";

export class RoomConfig extends Config{

    public sources: string[];
    public roomName: string;

    constructor(roomName: string) {
        if(!Memory.empire.myRooms[roomName]) {
            Memory.empire.myRooms[roomName] = {};
        }
        super();
        this.roomName = roomName;
        if(Memory.empire.myRooms[roomName].sources === undefined) {
            this.sources = [];
            Memory.empire.myRooms[roomName].sources = Game.rooms[roomName].find(FIND_SOURCES).map(i => i.id);
        } else {
            this.sources = Memory.empire.myRooms[this.roomName].sources
        }
    }

    public saveConfig(): void {
        if(this.changed === Game.time) {
            Memory.empire.myRooms[this.roomName] = this;
        }
    }
}