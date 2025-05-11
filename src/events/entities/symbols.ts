import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type SymbolDocument = HydratedDocument<Symbol>;

@Schema({ timestamps: true })
export class Symbol{
    @Prop()
    symbol:string;

    @Prop()
    precision:number;
}

export const SymbolSchema = SchemaFactory.createForClass(Symbol);
