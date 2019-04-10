import { RoomManager } from "../RoomManager";
import { RoomOperationMemoryInterface } from "./RoomOperationMemoryInterface";
import { RoomOperationInterface } from "./RoomOperationInterface";




export class RoomOperation implements RoomOperationInterface {
    public roomName: string;
    public data: any;
    public name: string;
    public type: string = "none";
    public priority: number;
    public manager: RoomManager;
    public pause: number;
    public didRun: boolean;
    public firstRun: boolean;
    public lastRun: boolean;
        constructor(manager: RoomManager, entry: RoomOperationMemoryInterface){
            this.manager = manager;
            this.roomName = this.manager.roomName;
            this.data=entry.data;
            this.name=entry.name;
            this.type=entry.type;
            this.priority= entry.priority;
            this.pause = entry.pause;
            this.didRun = false;
            this.firstRun = entry.firstRun;
            this.lastRun = entry.lastRun;
        }

    public toMemory(): RoomOperationMemoryInterface {
        return {roomName: this.roomName, data: {}, name: this.name, type: this.type, priority: this.priority, pause: this.pause, firstRun: this.firstRun, lastRun: this.lastRun};
    }

    /**
     * Logic executed at the beginning of EACH Tick
     */
    public init(): void{
        // TODO
    }
    /**
     * Logic Executed during Each Tick
     */
    public run(): void{
        if(this.firstRun){
            this.onfirstRun();
        }
        // TODO
        console.log("Running Operation: "+ this.name + " of Type:" + this.type);
        this.didRun = true;
    }
    /**
     * Logic Executed when Operation Runs the first time, setting up Spawns etc.
     */
    public onfirstRun(): void{
        console.log("Running FIRSTRUN Operation: "+ this.name + " of Type:" + this.type);
        this.firstRun = false;
        // TODO
    }
    /**
     * Logic Executed when Operation Runs the last Time. Destroying the Operation and potentially spawning a new Operation in the Manager ownning this Operation.
     */
    public onlastRun(): void {
        console.log("Running LASTRUN Operation: "+ this.name + " of Type:" + this.type);
        this.lastRun=true;
        // TODO
    }
    /**
     * Logic executed at the End of each Tick
     */
    public destroy(): void{
        // TODO
    }
}