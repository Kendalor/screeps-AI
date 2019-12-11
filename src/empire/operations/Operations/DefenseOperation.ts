
import { OperationsManager } from "empire/OperationsManager";
import { OperationMemory } from "./OperationMemory";
import { RoomOperation } from "./RoomOperation";






/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class DefenseOperation extends RoomOperation{
    

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "DefenseOperation";
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */

    public run() {

        const r: Room = this.room;
        console.log(r);

        if(r != null){
            const enemies: Creep[] = r.find(FIND_HOSTILE_CREEPS);
            if(enemies.length > 0) {
                const towers: StructureTower[] = r.find(FIND_MY_STRUCTURES).filter( str => str.structureType === STRUCTURE_TOWER) as StructureTower[];
                if (towers.length > 0 ){
                    for( const t of towers){
                        const a: Creep | null = t.pos.findClosestByRange(enemies);
                        if( a!= null){
                            t.attack(a); 
                        }
                    } 
                } else {
                    if( r.controller != null ) {
                        r.controller.activateSafeMode();
                    }
                }
            }
        }
        this.didRun=true;
    }

}