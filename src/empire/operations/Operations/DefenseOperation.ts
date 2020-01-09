
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
            } else {
                const myCreeps = r.find(FIND_MY_CREEPS).filter(creep => creep.hits < creep.hitsMax);
                if(myCreeps.length > 0) {
                    const towers: StructureTower[] = r.find(FIND_MY_STRUCTURES).filter( str => str.structureType === STRUCTURE_TOWER) as StructureTower[];
                    if (towers.length > 0 ){
                        for( const t of towers){
                            const a: Creep | null = t.pos.findClosestByRange(myCreeps);
                            if( a!= null){
                                t.heal(a); 
                            }
                        } 
                    } else {
                        if( r.controller != null ) {
                            r.controller.activateSafeMode();
                        }
                    }
                } else {
                    if(this.data.repair == null){
                        this.data.repair =[];
                    }
                    if(this.data.repair.length > 0){
                        const targets = this.idsToObjects(this.data.repair);

                    }
                }
            }
        }
        
    }
    private idsToObjects(ids: string[]): Structure[] {
        const out: Structure[] = [];
        for(const i of ids){
            const obj = Game.getObjectById(i) as Structure;
            if( obj != null){
                out.push(obj);
            }
        }
        return out;
    }

    private objectsToIds(objs: Structure[]): string[] {
        const out: string[] = [];
        for(const i of objs){
            if(i.hits <= i.hitsMax){
                out.push(i.id);
            }
        }
        return out;
    }

}