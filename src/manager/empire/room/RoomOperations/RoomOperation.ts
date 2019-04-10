import { RoomManager } from "../RoomManager";
import { RoomOperationDataInterface } from "./RoomOperationDataInterface";
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
        constructor(manager: RoomManager, entry: RoomOperationInterface){
            this.manager = manager;
            this.roomName = this.manager.roomName;
            this.data=entry.data;
            this.name=entry.name;
            this.type=entry.type;
            this.priority= entry.priority;
            this.pause = entry.pause;
            this.didRun = false;
        }

    public toMemory(): any {
        return {roomName: this.roomName, data: {}, name: this.name, type: this.type, priority: this.priority, pause: this.pause};
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
        // TODO
        console.log("Running Operation: "+ this.name + " of Type:" + this.type);
        this.didRun = true;
    }
    /**
     * Logic Executed when Operation Runs the first time, setting up Spawns etc.
     */
    public firstRun(): void{
        console.log("Running FIRSTRUN Operation: "+ this.name + " of Type:" + this.type);
        // TODO
    }
    /**
     * Logic Executed when Operation Runs the last Time. Destroying the Operation and potentially spawning a new Operation in the Manager ownning this Operation.
     */
    public lastRun(): void {
        console.log("Running LASTRUN Operation: "+ this.name + " of Type:" + this.type);
        // TODO
    }
    /**
     * Logic executed at the End of each Tick
     */
    public destroy(): void{
        // TODO
    }
}