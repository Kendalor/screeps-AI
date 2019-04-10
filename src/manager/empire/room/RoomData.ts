import { RoomDataInterface } from "./RoomDataInterface";
import { RoomManager } from "./RoomManager";
import { RoomOperation } from "./RoomOperations/RoomOperation";
import { RoomOperationInterface } from "./RoomOperations/RoomOperationInterface";

export class RoomData implements RoomDataInterface {
    public mine: boolean;
	public operations: RoomOperation[] = [];
    public roomName: string;
    public manager: RoomManager;

    constructor(manager: RoomManager){
        this.manager = manager;
        this.roomName = this.manager.roomName;
        if(Memory.rooms.roomName === undefined) {
            Memory.rooms[this.roomName] = {} as RoomDataInterface;
            if(Game.rooms.roomName === undefined) {
                this.mine = false;
            } else {
                if(Game.rooms.roomName.controller === undefined) {
                    this.mine = false;
                } else {
                    if(Game.rooms.roomName.controller.my) {
                        this.mine = true;
                    } else {
                        this.mine = false;
                    }
                }
            }
            this.save();
        } else {
            this.mine = Memory.rooms.roomName.mine;

        }

    }


    public init(): void {
        // TODO
    }


    public toMemory(): any {
        return {mine: this.mine, roomName: this.roomName, operations: this.operations.map( (entry) => entry.toMemory())}
    }

    public loadOperationList(): void {

        for(const i in Memory.rooms[this.roomName].operations) {
            this.operations.push(new RoomOperation(this.manager, Memory.rooms[this.roomName].operations[i] as RoomOperationInterface));
        }
    }

    public saveOperationList(): void {
        Memory.rooms[this.roomName].operations = [];
        for(const entry of this.operations) {
            if(entry.pause > 0){
                entry.pause = entry.pause -1;
            }
            Memory.rooms[this.roomName].operations.push(entry.toMemory(
			));
        }
    }

    public destroy(): void {
        // TODO
        this.save();
    }

    public save(): void{
        Memory.rooms[this.roomName].mine = this.mine;
        this.saveOperationList();
    }

}