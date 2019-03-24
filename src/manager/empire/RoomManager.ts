import { TowerManager } from "./TowerManager";

export class RoomManager {
    public roomName: string;
    public room: Room;
    public t_mgr: TowerManager;

    constructor(room: string) {
        this.roomName = room;
        this.room = Game.rooms[room];
        this.t_mgr = new TowerManager(this.room);
    }

    public run(): void {
        console.log("Running RoomManger for Room: " + this.roomName);
        this.t_mgr.run();
    }


    public autoSpawn(): void {
        // TODO
    }
}