import { RoomDataInterface } from "./RoomDataInterface";
import { RoomOperationInterface } from "./RoomOperations/RoomOperationInterface";

export class RoomData implements RoomDataInterface {
    public mine: boolean;
    public operations: RoomOperationInterface[];
    public roomName: string;

    constructor(roomName: string){
        this.roomName = roomName;
        if(Memory.rooms.roomName === undefined) {
            Memory.rooms[roomName] = {} as RoomDataInterface;
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

        }

    }


    public init(): void {
        if( Memory.rooms[this.roomName] === undefined) {
            Memory.rooms[this.roomName] = {};
        }
        if(Memory.rooms[this.roomName].mine === undefined ){
            Memory.rooms[this.roomName].mine = (Memory.rooms[this.roomName].mine === undefined) ? 
        }
    }

    public loadOperationList(): void {
        // TODO
    }

    public saveOperationList(): void {
        for(const op of this.operations) {
            Memory.rooms[this.roomName].operations=[];
        }
    }

    public destroy(): void {
        // TODO
        this.save();
    }

    public save(roomName: string): void{
        Memory.rooms[this.roomName].mine = this.mine;
        this.saveOperationList();
    }

}