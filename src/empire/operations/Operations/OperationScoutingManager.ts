import { OperationsManager } from "empire/OperationsManager";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { Operation } from "../Operation";
import { OperationMemory } from "./OperationMemory";










export class OperationScoutingManager extends Operation{
    private MAX_RANGE = 6;
    private DEFAULT_PAUSE = 1000;
    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "OperationScoutingManager";
    }


    public run() {
        super.run();
        this.validateTodo();
        if(this.data.todo.length > 0){
            this.data.numScouts = this.manager.empire.getMyRooms().length;
        }
        this.validateCreeps();
        if(this.data.numScouts > this.data.creeps.length){
            this.enqueueCreeps();
        }
        console.log("ScoutingManager: Radius: "+ this.getScoutingRadius() + " Todos: " + this.data.todo.length + " Creeps: (" + this.data.creeps.length + "/" + this.data.numScouts + ")");
    }

    public wakeup(): void {
        this.pause =0;
    }

    private enqueueCreeps(): void {
        console.log("enque Creeps");
        for(const roomName of this.manager.empire.getMyRooms()){
            if(this.data.numScouts > this.data.creeps.length){
                const todo = this.getNearestTodo(roomName);
                if(todo != null){
                        const name = this.manager.empire.spawnMgr.enque({
                            room: roomName,
                            body: [MOVE],
                            memory: {role: "Scout", op: this.name},
                            pause: 0,
                            priority: 40,
                            rebuild: false});
                        this.data.creeps.push(name);
                }
            }
        }
    }

    public validateTodo(): void {
        if(this.data.todo == null){
            this.data.todo = this.getRoomsInRange(this.manager.empire.getMyRooms(),this.getScoutingRadius());
        }
        let newTodo = new Array<string>();
        for(const e of this.data.todo){
            if(Game.map.isRoomAvailable(e)){
                if(RoomMemoryUtil.checkIfRoomNeedsScouting(e)){
                    newTodo.push(e);
                }
            }
        }
        if(newTodo.length === 0){
            console.log("NewTodo length: " + newTodo.length);
            if(this.getScoutingRadius() < this.MAX_RANGE){
                this.incrementScoutingRadius();
                newTodo = this.getRoomsInRange(this.manager.empire.getMyRooms(),this.getScoutingRadius());
            } else {
                this.pause = this.DEFAULT_PAUSE;
            }
        }
        this.data.todo = newTodo;
    }



    public getNearestTodo(roomName: string): string | undefined{
        if(this.data.todo.length > 0){
            const todos: string[] = this.data.todo;
            return todos.sort( (a,b) => Game.map.getRoomLinearDistance(roomName,a) - Game.map.getRoomLinearDistance(roomName,b)).shift();
        }
        return undefined;
    }


    private getScoutingRadius(): number {
        if(this.data.radius != null){
            return this.data.radius;
        } else {
            this.data.radius = 1;
            return this.data.radius;
        }
    }

    private incrementScoutingRadius(): void {
        if(this.data.radius < this.MAX_RANGE){
            console.log("Radius before increment: " + this.data.radius);
            this.data.radius =this.data.radius+1;
            console.log("Radius after increment: " + this.data.radius);
        }
    }

    private getAdjacentRooms(roomName: string): string[] {
        const out = new Array<string>();
        const exits=Game.map.describeExits(roomName);
        if(exits["1"] != null){
            const temp = exits["1"];
            if(temp !== undefined){
                out.push(temp);
            }
        }
        if(exits["3"] != null){
            const temp = exits["3"];
            if(temp !== undefined){
                out.push(temp);
            }
        }
        if(exits["5"] != null){
            const temp = exits["5"];
            if(temp !== undefined){
                out.push(temp);
            }
        }
        if(exits["7"] != null){
            const temp = exits["7"];
            if(temp !== undefined){
                out.push(temp);
            }
        }
        return out;
    }

    private getRoomsInRange(roomName: string[], range: number): string[]{
        if(range === 0){
            return roomName;
        } else {
            let out: string[] = [];
            if(roomName.length > 0){
                for(const n of roomName){
                    out=out.concat(this.getAdjacentRooms(n).filter(r => Game.map.isRoomAvailable(r)));
                }
            }
            return Array.from(new Set(out.concat(this.getRoomsInRange(out,range-1))));
        }
    }



}