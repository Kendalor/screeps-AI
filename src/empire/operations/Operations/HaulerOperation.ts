import { OperationsManager } from "empire/OperationsManager";
import { OperationMemory } from "./OperationMemory";
import { RoomOperation } from "./RoomOperation";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class HaulerOperation extends RoomOperation{
    

    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.type = "HaulerOperation";
    }

    public run() {
        super.run();
        const r: Room = this.room;



        if(this.data.numHaulers == null){
            this.data.numHaulers = 0;
        }

        // Validate creeps:
        this.validateCreeps();

        if( r != null && r.storage != null){
            if(this.data.numHaulers === 0 || Game.time % 1000 === 0){

                // Find Containers
                const containers = r.find(FIND_STRUCTURES).filter(
                    str => str.structureType === STRUCTURE_CONTAINER
                ) as StructureContainer[];

                // Calculate Required Carry/Move parts
                const dist: number = r.storage.pos.findPathTo(containers[0], {ignoreCreeps: true}).length + r.storage.pos.findPathTo(containers[1], {ignoreCreeps: true}).length;
                console.log("Calculated Distance: " + dist);
                const numCarryParts: number = Math.ceil(2*dist*10/50)+4;
                const moveParts: number = Math.ceil(numCarryParts/2)+2;
                const numHaulers = ((numCarryParts + moveParts)  * 50 <= r.energyCapacityAvailable) ? 1: 2;
                this.data.numHaulers = numHaulers;
                this.data.body = Array(numCarryParts/numHaulers).fill(CARRY).concat(Array(moveParts/numHaulers).fill(MOVE));
            }
            if(this.data.numHaulers > this.data.creeps.length) {
                for( let i=0; i< this.data.numHaulers - this.data.creeps.length; i++){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: r.name,
                        body: this.data.body,
                        memory: {role: "Hauler"},
                        pause: 0,
                        priority: 90,
                        rebuild: true});
                    this.data.creeps.push(name);
                }
            }

        }
    }


}