import { OperationsManager } from "empire/OperationsManager";
import { RoomOperation, RoomOperationProto } from "../Operations/RoomOperation";








/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class HaulerOperation extends RoomOperation{
    

    constructor(name: string, manager: OperationsManager, entry: RoomOperationProto) {
        super(name, manager,entry);
        this.type =  OPERATION.HAUL;
    }

    public run() {
        super.run();
        const t = Game.cpu.getUsed();
        // this.generateTodos();
        this.spawnMinerHaulers();

        
    }


    public generateTodos(): void {

        const containers = this.room.find(FIND_STRUCTURES).filter(str => str.structureType === STRUCTURE_CONTAINER) as StructureContainer[];
        const dropped = this.room.find(FIND_DROPPED_RESOURCES);
;

        // TODO
    }

    public spawnMinerHaulers(): void {
        const r: Room = this.room;
        if(this.data.numHaulers == null){
            this.data.numHaulers = 0;
        }

        // Validate creeps:
        this.validateCreeps();
        if( r != null && r.storage != null){
            if(Game.time % 1500 === 0){
                // Find Containers  
                const containers = r.find(FIND_STRUCTURES).filter(
                    str => str.structureType === STRUCTURE_CONTAINER
                ) as StructureContainer[];
                const cFiltered = containers.filter(con => con.store.getUsedCapacity() > 0);
                if(cFiltered.length > 0){
                    let dist: number = 5;
                    for(const c of cFiltered){
                        dist = dist+r.storage.pos.findPathTo(c, {ignoreCreeps: true}).length;
                    }
                    const numCarryParts: number = Math.ceil(2*dist*10/50)+4;
                    const moveParts: number = Math.ceil(numCarryParts/2)+2;
                    let numHaulers=0;
                    if(dist > 5){
                        numHaulers = ((numCarryParts + moveParts)  * 50 <= r.energyCapacityAvailable) ? 1: 2;
                    }
                    this.data.numHaulers = numHaulers;
                    this.data.body = Array(Math.floor(numCarryParts/numHaulers)).fill(CARRY).concat(Array(Math.floor(moveParts/numHaulers)).fill(MOVE));
                } else {
                    this.data.numHaulers=0;
                }
                const res = r.find(FIND_DROPPED_RESOURCES);
                const amount = _.sum(r.find(FIND_DROPPED_RESOURCES).map( resource => resource.amount));
                const minerals = res.filter( s => s.resourceType !== RESOURCE_ENERGY);
                if(amount > 2000 || minerals.length > 0){
                    if(this.data.numHaulers === 0){
                        this.data.numHaulers =1;
                    } else {
                        this.data.numHaulers = Math.max(3,this.data.numHaulers +1);
                    }                   
                }
            }

            if(this.data.numHaulers > this.data.creeps.length) {
                for( let i=0; i< this.data.numHaulers - this.data.creeps.length; i++){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: r.name,
                        body: this.data.body,
                        memory: {role: "Hauler", op: this.name},
                        pause: 0,
                        priority: 85,
                        rebuild: false});
                    this.data.creeps.push(name);
                }
            }
        }
    }

}