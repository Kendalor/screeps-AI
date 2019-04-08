import { RoomDataMemory } from "./RoomData_Memory";

export class RoomData implements RoomDataMemory {
    public mine: boolean;
    public status: ROOM_STATUS;

    constructor(roomName: string){
        if(Memory.rooms.roomName === undefined) {
            Memory.rooms[roomName] = {} as RoomDataMemory;
            if(Game.rooms.roomName === undefined) {
                this.mine = false;
                this.status = "buildup";
            } else {
                if(Game.rooms.roomName.controller === undefined) {
                    this.mine = false;
                    this.status = "buildup";
                } else {
                    if(Game.rooms.roomName.controller.my) {
                        this.mine = true;
                        this.status = "buildup";
                    } else {
                        this.mine = false;
                        this.status = "buildup";
                    }
                }
            }
            this.save(roomName);
        } else {
            this.mine = Memory.rooms.roomName.mine;
            this.status = Memory.rooms.roomName.status;

        }

    }


    public save(roomName: string): void{
        Memory.rooms.roomName.mine = this.mine;
        Memory.rooms.roomName.status = this.status;
    }

}