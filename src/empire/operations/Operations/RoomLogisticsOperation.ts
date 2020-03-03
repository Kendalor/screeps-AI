import { OperationsManager } from "empire/OperationsManager";
import { OPERATION, OperationMemory } from "utils/constants";
import { RoomOperation, RoomOperationProto } from "./RoomOperation";


interface LogisticTask {
    from: string;
    to: string;
    amount: number;
    type: ResourceConstant;
}





/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class RoomLogisticsOperation extends RoomOperation{
    private storageLink?: StructureLink;
    private controllerLink?: StructureLink;
    private sourceLinks?: StructureLink[];
    private tasks: LogisticTask[] = new Array<LogisticTask>();


    constructor(name: string, manager: OperationsManager, entry: RoomOperationProto) {
        super(name, manager,entry);
        this.type = OPERATION.ROOMLOGISTICS;
    }

    public run() {
        super.run();
        const r: Room = this.room;
        this.manageCreeps();
        this.processLinks();


    }
    private processLinks(): void {
        let storageLink;
        let controllerLink;
        let sourceLinks;
        if(this.room.storage != null){
            if(this.room.controller != null){
                if(this.room.controller.level >= 4){
                    storageLink = this.getStorageLink();
                    controllerLink = this.getControllerLink();
                    if(this.room.controller.level >= 7){
                        sourceLinks = this.getSourceLinks();
                    }
                    const providerLinks = new Array<StructureLink>();
                    const consumerLinks = new Array<StructureLink>();
                    if(storageLink != null){
                        providerLinks.push(storageLink);
                        consumerLinks.push(storageLink);
                    }
                    if(controllerLink != null){
                        consumerLinks.push(controllerLink);
                    }
                    if(sourceLinks != null && sourceLinks.length > 0){
                        for(const s of sourceLinks){
                            providerLinks.push(s);
                        }
                    }
                    const transferFrom = this.getLinksThatsNeedsTransferFrom(providerLinks);
                    if(transferFrom != null){
                        const transferTo = this.getLinksThatsCanTransferTo(consumerLinks);
                        if(transferTo != null){
                            transferFrom.transferEnergy(transferTo);
                        }
                    }
                }
            }
        }
    }


    public getAllLinks(): StructureLink[] {
        let storageLink;
        let controllerLink;
        let sourceLinks;
        const allLinks = new Array<StructureLink>();
        if(this.room.storage != null){
            if(this.room.controller != null){
                if(this.room.controller.level >= 4){
                    storageLink = this.getStorageLink();
                    controllerLink = this.getControllerLink();
                    if(this.room.controller.level >= 7){
                        sourceLinks = this.getSourceLinks();
                    }

                    if(storageLink != null){
                        allLinks.push(storageLink);
                    }
                    if(controllerLink != null){
                        allLinks.push(controllerLink);
                    }
                    if(sourceLinks != null && sourceLinks.length > 0){
                        for(const s of sourceLinks){
                            allLinks.push(s);
                        }
                    }
                }
            }
        }
        return allLinks;
    }

    public getLinkNetworkEnergyLevel(): number {
        const links = this.getAllLinks();
        let out = 0;
        for(const l of links){
            out = out + l.store.energy;
        }
        return out;
    }

    private getLinksThatsNeedsTransferFrom(input: StructureLink[]): StructureLink | null {
        const out = input.filter( link => link.store.getFreeCapacity(RESOURCE_ENERGY) === 0 && link.cooldown === 0).pop();
        if( out != null){
            return out;
        }
        return null;
    }

    private getLinksThatsCanTransferTo(input: StructureLink[]): StructureLink | null {
        const out = input.filter( link => link.store.getUsedCapacity(RESOURCE_ENERGY) === 0).pop();
        if( out != null){
            return out;
        }
        return null;
    }


    public getStorageLink(): StructureLink | null {
        if(this.storageLink != null){
            return this.storageLink;
        } else {
            if(this.data.storageLink != null){
                const link = Game.getObjectById<StructureLink>(this.data.storageLink);
                if(link != null){
                    this.storageLink = link;
                    return this.storageLink;
                }
            } else {
                if(this.room.storage != null){
                    const links = this.room.storage.pos.findInRange(FIND_MY_STRUCTURES,1).filter(str => str.structureType === STRUCTURE_LINK);
                    if(links != null){
                        if(links.length > 0){
                            const link = links.pop();
                            if(link != null){
                                this.storageLink = link as StructureLink;
                                this.data.storageLink = link.id;
                                return this.storageLink;
                            }
                        }
                    }
                }
            }
        }
        return null;
    }

    public getControllerLink(): StructureLink | null {
        if(this.controllerLink != null){
            return this.controllerLink;
        } else {
            if(this.data.controllerLink != null){
                const link = Game.getObjectById<StructureLink>(this.data.controllerLink);
                if(link != null){
                    this.controllerLink = link;
                    return this.controllerLink;
                }
            } else {
                if(this.room.storage != null){
                    const links = this.room.controller!.pos.findInRange(FIND_MY_STRUCTURES,3).filter(str => str.structureType === STRUCTURE_LINK);
                    if(links != null){
                        if(links.length > 0){
                            const link = links.pop();
                            if(link != null){
                                this.controllerLink = link as StructureLink;
                                return link as StructureLink;
                            }
                        }
                    }
                }
            }

        }
        return null;
    }

    private StructuresToIds(input: Structure[]): string[] {
        const out = new Array<string>();
        for(const id of input){
            out.push(id.id);
        }
        return out;
    }

    private IdsToStructures<T extends Structure>(input: string[]): T[] {
        const out = new Array<T>();
        for(const id of input){
            const link = Game.getObjectById<T>(id);
            if(link != null){
                out.push(link);
            }
        }
        return out;
    }

    private StructureArrayIsValid(input: RoomObject[]): boolean {
        for(const c of input){
            if(c == null){
                return false;
            }
        }
        return true;
    }

    private getSourceLinks(): StructureLink[] | undefined {
        if(this.sourceLinks != null){
            return this.sourceLinks;
        } else {
            if(this.data.sourceLinks != null && Game.time % 1500 !== 0){
                const out = this.IdsToStructures<StructureLink>(this.data.sourceLinks);
                if(this.StructureArrayIsValid(out)){
                    this.sourceLinks=out;
                    return this.sourceLinks;
                }
            } else {
                if(this.room.storage != null){
                    if(this.room.controller != null){
                        if(this.room.controller.level >= 7){
                            const sources = this.room.find(FIND_SOURCES);
                            const links = new Array<StructureLink>();
                            for(const s of sources){
                                const sourceLinks = s.pos.findInRange(FIND_MY_STRUCTURES,2).filter( str => str.structureType === STRUCTURE_LINK) as StructureLink[];
                                if(sourceLinks.length > 0){
                                    const l = sourceLinks.pop();
                                    if(l != null){
                                        links.push(l);
                                    }
                                }
                            }
                            if(links.length > 0){
                                this.sourceLinks=links;
                                this.data.sourceLinks = this.StructuresToIds(links);
                                return this.sourceLinks;
                            }
                        }
                    }
                }
            }

        }
        return undefined;
    }

    private manageCreeps(): void {
        let anchor: {x:number, y:number}  | null= null;
        if(this.room.memory.base != null){
            if(this.room.memory.base.anchor != null){
                anchor = this.room.memory.base.anchor;
            }
        }
        if(this.data.logstics == null){
            this.data.logistics = 1;
        }
        if(this.room.storage != null){
            // Validate creeps:
            this.validateCreeps();
            if(anchor != null){
                if( this.room != null && this.room.storage != null){
                    if(this.data.logistics > this.data.creeps.length) {
                        const body = [CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE] as BodyPartConstant[];
                    this.enqueCreep({
                            room: this.room.name,
                            toPos: anchor,
                            body: body,
                            memory: {role: "Logistic", op: this.name},
                            pause: 0,
                            priority: 95,
                            rebuild: false});
                    }
        
                }
            }
        }

    }

    private enqueCreep(entry: SpawnEntryMemory): void {
        const body = [CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE] as BodyPartConstant[];
        const name = this.manager.empire.spawnMgr.enque(entry);
            this.data.creeps.push(name);
    }


}