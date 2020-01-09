import { OperationsManager } from "empire/OperationsManager";
import { OperationMemory } from "./OperationMemory";
import { RoomOperation } from "./RoomOperation";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class HaulerOperation extends RoomOperation{
    

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
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
            if(this.data.numHaulers === 0 || Game.time % 500 === 0){

                // Find Containers
                const sources = r.find(FIND_SOURCES);

                const containers = r.find(FIND_STRUCTURES).filter(
                    str => str.structureType === STRUCTURE_CONTAINER
                ) as StructureContainer[];
                if(containers.length > 0){
                    const c1 = containers.filter( c => c.pos.isNearTo(sources[0])).pop() as StructureContainer;
                    const c2 = containers.filter( c => c.pos.isNearTo(sources[1])).pop() as StructureContainer;
    
                    // Calculate Required Carry/Move parts
                    const dist: number = r.storage.pos.findPathTo(c1, {ignoreCreeps: true}).length + r.storage.pos.findPathTo(c2, {ignoreCreeps: true}).length+5;
                    const numCarryParts: number = Math.ceil(2*dist*10/50)+4;
                    const moveParts: number = Math.ceil(numCarryParts/2)+2;
                    const numHaulers = ((numCarryParts + moveParts)  * 50 <= r.energyCapacityAvailable) ? 1: 2;
                    this.data.numHaulers = numHaulers;
                    this.data.body = Array(Math.ceil(numCarryParts/numHaulers)).fill(CARRY).concat(Array(Math.ceil(moveParts/numHaulers)).fill(MOVE));
    
                    // Requeue BuildCreeps with new Body
                    const res = _.sum(r.find(FIND_DROPPED_RESOURCES).filter ( resource => resource.resourceType === RESOURCE_ENERGY).map( resource => resource.amount));
                    if(res > 2000){
                        this.data.numHaulers +=1;
                    }
                } else {
                    this.data.numHaulers=0;
                }

            }
            if(this.data.numHaulers > this.data.creeps.length) {
                for( let i=0; i< this.data.numHaulers - this.data.creeps.length; i++){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: r.name,
                        body: this.data.body,
                        memory: {role: "Hauler", op: this.name},
                        pause: 0,
                        priority: 90,
                        rebuild: false});
                    this.data.creeps.push(name);
                }
            } else if( Game.time % 1500){
                for(const name of this.data.creeps){
                    this.manager.empire.spawnMgr.dequeueByName(name);
                }
            }

        }
    }


}