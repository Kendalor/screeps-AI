import { RoomManager } from "../RoomManager";

import { RoomOperation } from "./RoomOperation";
import { RoomOperationInterface } from "./RoomOperationInterface";





/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class MinerOperation extends RoomOperation{
    

    constructor(manager: RoomManager, entry: RoomOperationInterface) {
        super(manager,entry);
        this.type = "MinerOperation";
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */
    public onfirstRun(){
        console.log("Running super.onfirstRun()");
        super.onfirstRun();
        if(Game.rooms[this.roomName] !== undefined ){
            // SPAWN CREEPS HERE 
            console.log("MinerOperation")
            const r: Room = this.manager.room;
            console.log("Defined Room");
            const sources: Source[] = r.find(FIND_SOURCES);
            
            for(const s of sources){
                console.log("enqued Creep for: " + s.id);
                this.manager.spawnmgr.enque({
                    memory: {role: "Miner", sourceId: s.id},
                    name: this.manager.roomName +"_"+this.type+"_"+ s.id.substr(0,4),
                    pause: 0,
                    priority: 90,
                    rebuild: true});
            }
            
        }
        
    }


    public init() {
        // TODO
    }
    public run() {
        console.log("MinerOP OP Enqueue Creeps !");
        if(this.firstRun){
            console.log("First run Detected, running onFirstRun()");
            this.onfirstRun();
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