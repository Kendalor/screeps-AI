export interface CreepPreset {
    role: string;
    
    getBody(room: Room): BodyPartConstant[];

}