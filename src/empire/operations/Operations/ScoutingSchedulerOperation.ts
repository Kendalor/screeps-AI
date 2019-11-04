import { OperationsManager } from "empire/OperationsManager";
import { MapRoom } from "utils/MapRoom";
import { Operation } from "../Operation";
import { OperationMemory } from "./OperationMemory";







export class ScoutingSchedulerOperation extends Operation{
    
    private SCOUTING_INTERVALL = 10000;
    private myRooms: string[] = [];
    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.type = "ScoutingSchedulerOperation";
        for(const key of Object.keys(Game.rooms)){
            const r: Room = Game.rooms[key];
            if( r!= null){
                if( r.controller != null){
                    if (r.controller.my === true){
                        this.myRooms.push(key);
                    }
                }
            }
        }
    }


    public run() {
        console.log("Scouting Sheduler: ");
        super.run();

        // Init List of Owned Rooms

        if( Game.time % 50 === 0) {
            this.validateTodos();
        }
        if( Object.keys(this.data.toDo).length === 0){
            this.incrementRange();
            this.addRooms();
        }



    }


    public addRooms(): void {
        if(this.data.toDo == null){
            this.data.toDo = [];
        }
        if(this.data.range == null) {
            this.data.range = 1;
        }
        let roomList: string[] =new Array<string>();

        for(const r of this.myRooms){
            const room = new MapRoom(r);
            const list = room.getRoomsInRange(this.data.range);
            roomList = roomList.concat(list);
        }
        for(const key of roomList){
            if(Game.map.isRoomAvailable(key)){
                if(Memory.rooms[key] == null){
                    Memory.rooms[key] = {};
                }
            }
        }
        this.updateTodos(); 
    }


    public validateTodos(): void {
        for(const key of Object.keys(this.data.toDo)){
            const mem = Memory.rooms[key];
            if(Game.map.isRoomAvailable(key)){
                if(mem != null){
                    if(mem.scouting != null){
                        if(mem.scouting.lastSeen != null){
                            if(mem.scouting.lastSeen >= Game.time - this.SCOUTING_INTERVALL){
                                delete this.data.toDo[key];
                            }
                        }
                    }
                }
            } else {
                delete this.data.toDo[key];
            }

        }
    }

    public updateTodos(): void {
        const toDo: string[] = [];
        for(const key of Object.keys(Memory.rooms)){
            if(Memory.rooms[key] != null){
                if(Memory.rooms[key].scouting == null){
                    toDo.push(key);
                } else {
                    if(Memory.rooms[key].scouting.lastSeen <= Game.time-this.SCOUTING_INTERVALL){
                        toDo.push(key);
                    }
                }
            }
        }
        for(const name of toDo){
            if(this.data.toDo[name] == null){
                this.data.toDo[name] = this.manager.enque({type: "UpdateRoomMemory", priority: 20, data: {roomName: name}, pause: 0, lastRun: false});
            }
        }

    }

    public incrementRange(): void {
        if(this.data.range == null) {
            this.data.range = 1;
        }
        this.data.range +=1;
    }


}