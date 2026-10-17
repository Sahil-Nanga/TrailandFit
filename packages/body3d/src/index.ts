export { ASSET_BASE, assetUrl } from "./assets";
export { BodyModel, type BodyPoints } from "./BodyModel";
export { type FittedShape, fitBody } from "./fitClient";
export { GarmentImageError, type GarmentPicture, loadGarmentPicture } from "./garmentImageClient";
export { GarmentModel } from "./GarmentModel";
export { GARMENT_STYLES, GARMENT_TEMPLATES, type GarmentCategory, type GarmentRoom, type GarmentStyle, garmentStyle } from "./garments";
export { HAIR_COLORS, HAIR_STYLES, HairModel, type HairStyle } from "./HairModel";
export { influencesFor } from "./influences";
export { bakeLikeness, bakeLikenessFromUrl, type Likeness, LikenessError } from "./likenessClient";
export {
  type BodyInput,
  type BodyShape,
  type Calibration,
  type Dimension,
  measurementsToShape,
  type MorphName,
  predictUnscaled,
  type Weights,
  weightParameter,
} from "./morphs";
export { Stage } from "./Stage";
export { type FitStatus, useFittedShape } from "./useFittedShape";
