import { buildAssociationReview } from "../lib/build-association-review.js";
console.log(JSON.stringify(buildAssociationReview(process.argv[2] ?? process.cwd())));
