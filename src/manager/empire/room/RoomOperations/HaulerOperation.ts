import { RoomManager } from "../RoomManager";

import { RoomOperation } from "./RoomOperation";
import { RoomOperationInterface } from "./RoomOperationInterface";





/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class HaulerOperation extends RoomOperation{
    

    constructor(manager: RoomManager, entry: RoomOperationInterface) {
        super(manager,entry);
        this.type = "HaulerOperation";
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */
    public onfirstRun(){
        console.log("Running super.onfirstRun()");
        super.onfirstRun();
        if(Game.rooms[this.roomName] !== undefined ){
            // SPAWN CREEPS HERE 
            console.log("HaulerOperation")
            const r: Room = this.manager.room;
            console.log("Defined Room");
            const containers = r.find(FIND_STRUCTURES).filter(
                str => str.structureType === STRUCTURE_CONTAINER
            ) as StructureContainer[];

            if( containers.length === 2  && r.storage != null){
                console.log("Found 2 Containers");
                const dist: number = r.storage.pos.findPathTo(containers[0], {ignoreCreeps: true}).length + r.storage.pos.findPathTo(containers[1], {ignoreCreeps: true}).length;
                console.log("Calculated Distance: " + dist);
                const numCarryParts: number = Math.ceil(2*dist*10/50)+4;
                const moveParts: number = Math.ceil(numCarryParts/2)+2;
                if((numCarryParts + moveParts)  * 50 <= r.energyCapacityAvailable){
                    const body: BodyPartConstant[] = Array(numCarryParts).fill(CARRY).concat(Array(moveParts).fill(MOVE));
                    console.log("enqued Hauler Creep for: ");
                    this.manager.spawnmgr.enque({
                        body: body,
                        memory: {role: "Hauler"},
                        name: this.manager.roomName +"_"+this.type+"_",
                        pause: 0,
                        priority: 90,
                        rebuild: true});
                    super.onfirstRun(); 
                } else {
                    const body: BodyPartConstant[] = Array(Math.ceil(numCarryParts/2)).fill(CARRY).concat(Array( Math.ceil(moveParts/2)).fill(MOVE));
                    this.manager.spawnmgr.enque({
                        body: body,
                        memory: {role: "Hauler"},
                        name: this.manager.roomName +"_"+this.type+"_1",
                        pause: 0,
                        priority: 90,
                        rebuild: true});
                    this.manager.spawnmgr.enque({
                        memory: {role: "Hauler"},
                        name: this.manager.roomName +"_"+this.type+"_2",
                        pause: 0,
                        body: body,
                        priority: 90,
                        rebuild: true});
                }


            }
            
        }
        
    }


    public init() {
        // TODO
    }
    public run() {
        console.log("HaulerrOP OP Enqueue Creeps !");
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