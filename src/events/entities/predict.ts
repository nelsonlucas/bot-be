import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type PredictDocument = HydratedDocument<Predict>;

@Schema({ timestamps: true })
export class Predict {
    @Prop()
    ticker:string
    @Prop()
    date:Date
    @Prop()
    open:number
    @Prop()
    close:number
    @Prop()
    predictClose:number
    @Prop()
    operation:string
}

export const PredictSchema = SchemaFactory.createForClass(Predict);