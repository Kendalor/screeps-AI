import { OperationsManager } from "empire/OperationsManager";
import { OperationMemory } from "./OperationMemory";
import { RoomOperation } from "./RoomOperation";



export class MinerOperation extends RoomOperation{
    

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "MinerOperation";
    }

    public run() {
        super.run()

        const r: Room = this.room;
        if(r!= null ){
            // Validate creeps:
            this.validateCreeps();


            if(this.data.sources == null){
                this.data.sources = {};
                const sources: Source[] = r.find(FIND_SOURCES);
                for(const s of sources){
                    this.data.sources[s.id]={};
                }
            }

            // // DECIDE Between 1 or 2 Miners
            // const energy = r.energyCapacityAvailable;
            // const sources = r.find(FIND_SOURCES);
            
            // if(sources.length === 2)  {
            //     const distance = sources[0].pos.findPathTo(sources[1]).length;
            //     // Calculate required WORK parts such that the Miner can harvest both nodes within 300 ticks including Travel Time
            //     // 5 WORK to get source in 300 ticks => 10 WORK => 150 ticks  distance = Ticks
            //     // (NumSources*Energy)/(TimeUntiLReset-Traveltime)+1 (Buffer) 
            //     const workParts = Math.ceil((2*3000/2)/(300-distance))+1;
            //     const carryParts = 1
            //     const moveParts = Math.ceil((workParts+carryParts)/2);
            //     const totalCost = 100*workParts+50*(carryParts+moveParts);
            //     const numMiners = totalCost <= energy ? 1: 2;
            // }

            // // MineLink or MineContainer ?
            // if(r.controller != null && r.controller.level >= 6){
            //     const numLinks = r.find(FIND_MY_STRUCTURES).filter( str => str.structureType === STRUCTURE_LINK).length;
            //     const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK][r.controller!.level];
            // }





            if(this.data.creeps.length < 2 ){
                const sources: Source[] = r.find(FIND_SOURCES);
                for(const s of sources){
                    console.log("enqued Creep for: " + s.id);
                    const name = this.manager.empire.spawnMgr.enque({
                        room: s.room.name,
                        memory: {role: "ContainerMiner", sourceId: s.id, op: this.name},
                        pause: 0,
                        priority: 90,
                        rebuild: true});
                    this.data.creeps.push(name);
                }

            }

        }
    }

}