import { OperationsManager } from "empire/OperationsManager";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { Operation } from "../Operation";
import { OperationMemory } from "./OperationMemory";










export class OperationScoutingManager extends Operation{
    private MAX_RANGE = 6;
    private DEFAULT_PAUSE = 500;
    private DEFAULT_VALIDATION_INTERVALL = 1;

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "OperationScoutingManager";
    }


    public run() {
        super.run();
        if(Game.cpu.bucket > 400){
            if(this.hasChanged() ){
                this.validateTodo();
                this.setChanged(false);
            }
        }

        this.setNumScouts();

        this.validateCreeps();

        if(this.data.numScouts > this.data.creeps.length){
            this.enqueueCreeps();
        }

        // this.sleep();
        console.log("ScoutingManager: Radius: "+ this.getScoutingRadius() + " Todos: " + this.data.todo.length + " Creeps: (" + this.data.creeps.length + "/" + this.data.numScouts + ")");
    }

    public wakeup(): void {
        this.pause =0;
    }

    public setChanged(a: boolean):void {
        this.data.changed = a;
    }

    private hasChanged(): boolean {
        if(this.data.changed == null || Game.time % 5000 === 0 || Math.random() < 0.05){
            return true;
        } else {
            return this.data.changed;
        }
    }

    private setNumScouts(): void {
        if(this.data.todo.length > 0){
            this.data.numScouts = Math.min(this.manager.empire.getMyRooms().length, Math.ceil(this.data.todo.length / 10));
        } else {
            this.data.numScouts =0;
        }
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
        let newTodo = this.checkAllRooms(this.data.todo);
        if(newTodo.length === 0){
            let increased = false;
            if(this.getScoutingRadius() < this.MAX_RANGE){
                this.incrementScoutingRadius();
                increased = true;
            }
            if(this.validateMemory() || increased){

                newTodo = this.getRoomsInRange(this.manager.empire.getMyRooms(),this.getScoutingRadius());

            } else {
                newTodo = this.checkAllRooms(RoomMemoryUtil.getRoomsInMemory());
            }


        }
        this.data.todo = newTodo;
    }

    private sleep(): void {
        this.pause = this.DEFAULT_PAUSE;
    }

    private checkAllRooms(rooms: string[]): string[]{
        let t = Game.cpu.getUsed();
        const newTodo = new Array<string>();
        let k = Game.cpu.getUsed();
        console.log("CPU: for Array "+ (k-t));
        for(const e of this.data.todo){
            if(Game.map.isRoomAvailable(e)){
                console.log("CheckAllRooms: "+ e);
                t = Game.cpu.getUsed();
                if(RoomMemoryUtil.checkIfRoomNeedsScouting(e)){
                    newTodo.push(e);
                }
                k = Game.cpu.getUsed();
                console.log("CPU: for "+e+  " "+ (k-t));

            }
        }
        return newTodo;
    }
    public resetLastValidation(): void {
        this.data.lastValidation = Game.time;
    }

    public validateMemory(): boolean {
        if(this.data.lastValidation == null){
            return true;
        } else {
            if(this.data.lastValidation +this.DEFAULT_VALIDATION_INTERVALL < Game.time ){
                this.resetLastValidation();
                return true;
            }
        }
        return false;
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

    /*
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
    */

    private getRoomsInRange(roomName: string[], range: number): string[]{
        const out = new Set<string>();
        const checked = new Set<string>();
        let toCheck = new Set<string>(roomName);
        let iterList =new Set<string>();
        for(let i=0; i<range; i=i+1){
            iterList = new Set<string>();
            for(const r of toCheck){
                if(!checked.has(r)){
                    if(Game.map.isRoomAvailable(r)){
                        checked.add(r);
                    }
                    const adjacent = this.getAdjacentRooms(r);
                    for(const a of adjacent){
                        if(Game.map.isRoomAvailable(a)){
                            if(!iterList.has(a)){
                                iterList.add(a);
                            }
                        }
                    }
                }
            }
            toCheck = new Set<string>();
            for(const e of iterList){
                if(!checked.has(e)){
                    if(!toCheck.has(e)){
                        toCheck.add(e);
                    }
                }
            }
        }
        for(const a of checked){
            if(!out.has(a)){
                out.add(a);
            }
        }
        for(const a of toCheck){
            if(!out.has(a)){
                out.add(a);
            }
        }


        return Array.from(out);
    }



}