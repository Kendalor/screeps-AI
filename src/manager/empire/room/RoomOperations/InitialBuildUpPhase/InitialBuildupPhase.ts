import { RoomManager } from "../../RoomManager";
import { RoomOperation } from "../RoomOperation";
import { RoomOperationInterface } from "../RoomOperationInterface";





/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class InitialBuildUpPhase extends RoomOperation{
    

    constructor(manager: RoomManager, entry: RoomOperationInterface) {
        super(manager,entry);
        this.type = "InitialBuildUpPhase";
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */
    public onfirstRun(){
        console.log("Running super.onfirstRun()");
        super.onfirstRun();
        if(Game.rooms[this.roomName] !== undefined ){
            // SPAWN CREEPS HERE 
            console.log("InitialBuildUP OP Enqueue Creeps ! DASDASDASDASD")
            const r: Room = this.manager.room;
            console.log("Defined Room");
            const numSources= r.find(FIND_SOURCES).length
            console.log(" Found Sources: " + numSources);
            for(let i=0; i<numSources *3; i++){
                console.log("enqued Creep for: " + i);
                this.manager.spawnmgr.enque({
                    memory: {role: "Maintenance"},
                    name: this.manager.roomName +"_"+this.type+"_"+i,
                    pause: 0,
                    priority: 100,
                    rebuild: true});
            }
            
        }
        
    }


    public init() {
        // TODO
    }
    public run() {
        console.log("InitialBuildUP OP Enqueue Creeps !");
        if(this.firstRun){
            console.log("First run Detected, running onFirstRun()");
            this.onfirstRun();
        }
        if(this.manager.data.operations.length === 1){
            console.log("Enque Miner Op");
            this.manager.data.enque({name: "MinerOp", type: "MinerOperation", data: {}, roomName: this.roomName, priority: 90,pause: 1,firstRun: true, lastRun: false});
        }
        if(this.manager.data.operations.length === 2){
            this.manager.data.enque({name: "HaulerOp", type: "HaulerOperation", data: {}, roomName: this.roomName, priority: 89,pause: 1,firstRun: true, lastRun: false});
        }
        if(this.manager.data.operations.filter( (op) => op.type === "DefenseOperation").length === 0){
            console.log("Added Defense Operation");
            this.manager.data.enque({name: "DefenseOp", type: "DefenseOperation", data: {}, roomName: this.roomName, priority: 91,pause: 1,firstRun: true, lastRun: false});
        }
        if(this.manager.data.operations.filter( (op) => op.type === "UpgradeOperation").length === 0){
            console.log("Added Upgrade Operation");
            this.manager.data.enque({name: "UpgradeOp", type: "UpgradeOperation", data: {}, roomName: this.roomName, priority: 70,pause: 1,firstRun: true, lastRun: false});
        }
        if(this.manager.data.operations.filter( (op) => op.type === "SupplyOperation").length === 0){
            console.log("Added Supply Operation");
            this.manager.data.enque({name: "SupplyOp", type: "SupplyOperation", data: {}, roomName: this.roomName, priority: 80,pause: 1,firstRun: true, lastRun: false});
        }
        if(this.manager.data.operations.filter( (op) => op.type === "BuildOperation").length === 0){
            console.log("Added Build Operation");
            this.manager.data.enque({name: "BuildOp", type: "BuildOperation", data: {}, roomName: this.roomName, priority: 60,pause: 1,firstRun: true, lastRun: false});
        }
        if(this.manager.data.operations.filter( (op) => op.type === "RepairOperation").length === 0){
            console.log("Added Repair Operation");
            this.manager.data.enque({name: "RepairOp", type: "RepairOperation", data: {}, roomName: this.roomName, priority: 65,pause: 1,firstRun: true, lastRun: false});
        }
        if(Game.rooms[this.roomName].controller!.level >= 4) {
            const entries = this.manager.data.toSpawnList.filter( entry => entry.memory.role === "Maintenance" && entry.rebuild === true);
            for(const e of entries){
                this.manager.spawnmgr.dequeue(e);
            }
        }
        if(this.manager.data.toSpawnList.filter( entry => entry.memory.role === "Maintenance").length === 0){
            if(Game.rooms[this.roomName].find(FIND_MY_CREEPS).length === 0){
                this.manager.spawnmgr.enque({
                    memory: {role: "Maintenance"},
                    name: this.manager.roomName +"_"+this.type ,
                    pause: 0,
                    priority: 100,
                    rebuild: false});
            }
        }


        this.didRun=true;

        

        // TODO
    }

    public destroy() {
        // TODO
    }

    public onlastRun() {
        // TODO
    }

}