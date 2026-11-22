import { Router } from "express";
import { verifyJWT } from "../middleware/auth.js";

const router = Router();

router.get("/", verifyJWT, (req, res) => {
  res.json({ user: req.user });
});

export default router;