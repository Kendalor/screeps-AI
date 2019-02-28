import { EmpireManager } from "manager/empire/EmpireManager";
import { Manager } from "manager/Manager";
import { RoomConfig } from "./RoomConfig";
import { SourceManager } from "./source/SourceManager";

export class RoomManager extends Manager<RoomConfig>{
    public roomName: string;
    public mgr: EmpireManager;
    public room: Room;

    constructor(mgr: EmpireManager, roomName: string) {
        super(RoomConfig, roomName);
        this.room = Game.rooms[roomName];
        this.roomName=roomName;
        this.mgr = mgr;
    }

    public run(){
        console.log("Room Manager:" + this.roomName);
        console.log("Spawning source Managers for: "+ this.config.sources);
        for(const i in this.config.sources) {
            const smgr: SourceManager = new SourceManager(i);
            smgr.run()
            smgr.destroy();
        }
    }

    public addNearestSource() {
            // TODO
    }
};